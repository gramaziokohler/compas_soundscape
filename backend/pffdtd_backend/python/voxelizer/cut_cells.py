##############################################################################
# compas: conformal (cut-cell finite-volume) boundaries for the Cartesian scheme.
#
# Not part of upstream PFFDTD. The scheme reads each grid node as the centre of a cubic
# cell of side h. Upstream gives every boundary cell its full volume and keeps or cuts
# each of its 6 faces (binary links), so oblique walls are staircased: the effective wall
# sits ~0.2-0.4 h off the true surface, and modal frequencies converge at 1st order only.
#
# Here, every cell that a wall passes through gets:
#   vol (kappa): the fraction of its volume inside the air,
#   beta[k]:     the open (air) fraction of each of its 6 faces, shared by both cells,
#   saf:         the true wall area inside the cell / h^2 (for lossy walls).
# The update becomes  kappa_i (u+ - 2u + u-) = l^2 sum_k beta_ik (u_k - u_i)  (- wall terms),
# i.e. a finite-volume scheme on the cut cells. Volumes and face areas are exact for
# planar walls (convex clipping of the cell by the wall half-spaces).
#
# The "air" is the grid component that contains the source(s): a flood fill over the
# binary (staircase) links. Cells whose node lies outside that component but whose cell
# holds some air (fragments) join the air as small cut cells. Anything else (exterior,
# inside solid objects) keeps the binary links and is decoupled from the air.
#
# Stability: the energy of the scheme stays positive iff kappa_i >= (l^2/2) sum_k beta_ik.
# Small cut cells break this at the usual (maximal) Courant number. They borrow the missing
# volume from cells with spare volume up to LEND_HOPS open faces away: the total volume is
# unchanged and mass only moves O(h), so the scheme stays 2nd order. (Shrinking their faces,
# or merging them with a neighbour, moves the effective wall by O(h) instead.)
#
# Fallback to the staircase (binary) treatment, per cell: two-sided/thin surfaces (air on
# both sides), and cells where the walls form neither a convex (intersection) nor a reflex
# (union) configuration.
##############################################################################

import numpy as np
from numpy import array as npa
import numba as nb

from voxelizer.cut_cell_geom import (AIR_BACK, AIR_FRONT, AIR_NONE, AIR_THIN, ST_CUT, ST_FALLBACK,
                                    _cell_geometry, _tri_air_side, tri_cell_pairs)

KAPPA_MIN = 1e-6     # smaller cut cells are dropped (volume lost < KAPPA_MIN*h^3 each)
STAB_MARGIN = 1e-3   # cut cells satisfy kappa >= (1+margin) * (l^2/2) * sum(beta)
LEND_HOPS = 6        # small cut cells borrow volume from cells up to this many open faces away
LEND_RING_MAX = 1024 # max cells per ring in the volume-lending search

# Cartesian neighbour order used everywhere in PFFDTD: +x,-x,+y,-y,+z,-z
IVV = npa([[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]],dtype=np.int64)


def _print(fstring):
    print(f'--CUT_CELLS: {fstring}')


################################################################################
# air labels
################################################################################

@nb.njit(parallel=True)
def _open_bits(Npts,bn_ixyz,adj_bn):
    bits = np.full(Npts,np.uint8(63))
    for i in nb.prange(bn_ixyz.size):
        b = np.uint8(0)
        for k in range(6):
            if adj_bn[i,k]:
                b |= np.uint8(1<<k)
        bits[bn_ixyz[i]] = b
    return bits


@nb.njit
def _flood_sweep(lab,bits,Nx,Ny,Nz,forward):
    off = (Ny*Nz,-Ny*Nz,Nz,-Nz,1,-1)
    changed = 0
    for q in range(1,Nx-1):
        ix = q if forward else Nx-1-q
        for r in range(1,Ny-1):
            iy = r if forward else Ny-1-r
            for s in range(1,Nz-1):
                iz = s if forward else Nz-1-s
                ii = ix*Ny*Nz + iy*Nz + iz
                if lab[ii]:
                    continue
                b = bits[ii]
                for k in range(6):
                    if (b>>k)&1 and lab[ii+off[k]]:
                        lab[ii] = 1
                        changed += 1
                        break
    return changed


def flood_air(Nx,Ny,Nz,bn_ixyz,adj_bn,seed_ixyz,max_sweeps=10000):
    """(uint8 label per grid node: 1 = in the binary-link component of a seed node,
    number of grid-edge nodes the air reaches: > 0 means the model is open)."""
    bits = _open_bits(Nx*Ny*Nz,bn_ixyz,adj_bn)
    lab = np.zeros(Nx*Ny*Nz,dtype=np.uint8)
    lab[np.asarray(seed_ixyz,dtype=np.int64)] = 1
    for it in range(max_sweeps):
        changed = _flood_sweep(lab,bits,Nx,Ny,Nz,it%2==0)
        if changed==0:
            break
    else:
        raise RuntimeError('air flood fill did not converge')
    n_edge = _label_edge_planes(lab,bits,Nx,Ny,Nz)
    _print(f'air flood fill: {int(lab.sum())} nodes, {it+1} sweeps')
    if n_edge:
        _print(f'WARNING: the air reaches the grid edge at {n_edge} nodes: the model is open and sound leaks out')
    return lab,n_edge


def _label_edge_planes(lab,bits,Nx,Ny,Nz):
    """Label the grid-edge planes from their inner neighbours; returns the count labelled.

    The sweeps skip the edge planes: the engine never updates them, it mirrors them from the
    plane two cells in (a rigid grid box). Their links to the first inner plane stay open, so
    when the air reaches the edge (an open model) they must read as air too, or the cut-cell
    links to them come out cut on one side only.
    """
    lab3 = lab.reshape(Nx,Ny,Nz)
    bits3 = bits.reshape(Nx,Ny,Nz)
    n0 = int(lab.sum())
    for ax,(k_lo,k_hi) in enumerate(((1,0),(3,2),(5,4))): #link from the inner plane towards -/+ edge
        lo,in_lo = [slice(None)]*3,[slice(None)]*3
        hi,in_hi = [slice(None)]*3,[slice(None)]*3
        lo[ax],in_lo[ax],hi[ax],in_hi[ax] = 0,1,-1,-2
        lo,in_lo,hi,in_hi = tuple(lo),tuple(in_lo),tuple(hi),tuple(in_hi)
        lab3[lo] |= lab3[in_lo] & ((bits3[in_lo]>>k_lo)&1)
        lab3[hi] |= lab3[in_hi] & ((bits3[in_hi]>>k_hi)&1)
    return int(lab.sum())-n0


################################################################################
# stability
################################################################################

@nb.njit
def _lend_volume(beta,nbr,nbr_ok,inR,kap,order,fac,max_hops):
    """Move volume to unstable cut cells from cells with spare volume nearby.

    A cell is stable iff kap >= (fac/2) * sum(beta); its slack is the excess. Cells in `order`
    (smallest first) borrow their deficit from cells reachable within `max_hops` open faces,
    nearest ring first and largest slack first. The total volume is unchanged, and mass only
    moves O(h), which keeps 2nd-order accuracy (faces are never changed, so the wall stays
    where it is). Returns (new kap, remaining deficit per cell).
    """
    NT = kap.size
    kap = kap.copy()
    S = np.zeros(NT)
    for i in range(NT):
        S[i] = beta[i].sum()
    deficit = np.zeros(NT)
    seen = np.full(NT,-1,dtype=np.int64)
    ring = np.empty(LEND_RING_MAX,dtype=np.int64)
    nxt_ring = np.empty(LEND_RING_MAX*6,dtype=np.int64)
    for j in order:
        d = 0.5*fac*S[j]-kap[j]
        if d<=0.0:
            continue
        seen[j] = j
        ring[0] = j
        nr = 1
        for hop in range(max_hops):
            nn = 0
            for q in range(nr):
                n = ring[q]
                for k in range(6):
                    if nbr_ok[n,k] and beta[n,k]>0.0:
                        m = nbr[n,k]
                        if inR[m] and seen[m]!=j and nn<nxt_ring.size:
                            seen[m] = j
                            nxt_ring[nn] = m
                            nn += 1
            if nn==0:
                break
            slack = np.empty(nn)
            for q in range(nn):
                m = nxt_ring[q]
                slack[q] = kap[m]-0.5*fac*S[m]
            for q in np.argsort(-slack):
                if d<=0.0:
                    break
                if slack[q]<=0.0:
                    break
                t = min(slack[q],d)
                m = nxt_ring[q]
                kap[m] -= t
                kap[j] += t
                d -= t
            if d<=0.0:
                break
            nr = min(nn,ring.size)
            for q in range(nr):
                ring[q] = nxt_ring[q]
        deficit[j] = max(d,0.0)
    return kap,deficit


################################################################################
# driver
################################################################################

def apply_cut_cells(vox_scene,seed_ixyz,l2,flood=None):
    """Turn the binary (staircase) voxelisation of `vox_scene` into cut cells (in place).

    Sets vox_scene.bn_ixyz/adj_bn/mat_bn/saf_bn and adds beta_bn (open face fractions,
    [Nb,6]), vol_bn (volume fractions, [Nb]) and air_leak (None, or the grid-edge node count
    and air volumes when the air reaches the grid edge). Cartesian grids only.
    `flood` = the (lab, n_edge) of flood_air for these seeds, when the caller already has it.
    """
    assert not vox_scene.fcc, 'cut cells are Cartesian-only'
    cg = vox_scene.cart_grid
    rg = vox_scene.room_geo
    h = float(cg.h)
    Nx,Ny,Nz = (int(v) for v in cg.Nxyz)
    N = npa([Nx,Ny,Nz],dtype=np.int64)
    o = npa([cg.xv[0],cg.yv[0],cg.zv[0]],dtype=np.float64)
    off = IVV @ npa([Ny*Nz,Nz,1],dtype=np.int64)

    bn = vox_scene.bn_ixyz
    adj = vox_scene.adj_bn
    order = np.argsort(bn)
    bn,adj = bn[order],adj[order]
    mat_v = vox_scene.mat_bn[order]
    tidx_v = vox_scene.tidx_bn[order]

    lab,n_edge = flood if flood is not None else flood_air(Nx,Ny,Nz,bn,adj,seed_ixyz)

    tri_pts = np.ascontiguousarray(rg.pts[rg.tris],dtype=np.float64)
    nrm = np.cross(tri_pts[:,1]-tri_pts[:,0],tri_pts[:,2]-tri_pts[:,0])
    tri_n = nrm/np.linalg.norm(nrm,axis=-1)[:,None]
    tri_d = np.sum(tri_n*tri_pts[:,0],axis=-1)
    tri_side = np.asarray(rg.mat_side,dtype=np.int8)
    tri_air = _tri_air_side(tri_pts,tri_n,tri_side,lab,o,h,N)
    _print(f'triangles: {np.sum(tri_air==AIR_FRONT)} air-front, {np.sum(tri_air==AIR_BACK)} air-back, '
           f'{np.sum(tri_air==AIR_THIN)} thin, {np.sum(tri_air==AIR_NONE)} unused')

    p_node,p_tri = tri_cell_pairs(tri_pts,tri_n,tri_air!=AIR_NONE,o,h,N)
    po = np.lexsort((p_tri,p_node))
    p_node,p_tri = p_node[po],p_tri[po]
    cells,ptr = np.unique(p_node,return_index=True)
    ptr = np.r_[ptr,p_node.size].astype(np.int64)
    ckap,cbeta,cstat,parea = _cell_geometry(cells,ptr,p_tri,tri_pts,tri_n,tri_d,tri_air,o,h,N)

    is_cut_c = (cstat==ST_CUT) & (ckap>KAPPA_MIN)
    _print(f'cells touched: {cells.size}, cut {np.sum(is_cut_c)}, fallback {np.sum(cstat==ST_FALLBACK)}, '
           f'dropped (kappa<={KAPPA_MIN:g}) {np.sum((cstat==ST_CUT) & ~is_cut_c)}')

    # touched node set T and its attributes
    ring1 = (cells[:,None]+off[None,:]).ravel()
    ring2 = (np.unique(ring1)[:,None]+off[None,:]).ravel() #second ring: more lenders for the small cells
    T = np.unique(np.r_[bn,cells,ring1,ring2])
    NT = T.size

    def _lookup(keys,sorted_arr):
        pos = np.minimum(np.searchsorted(sorted_arr,keys),max(sorted_arr.size-1,0))
        found = (sorted_arr.size>0) & (sorted_arr[pos]==keys)
        return pos,found

    pc,in_c = _lookup(T,cells)
    pb,in_b = _lookup(T,bn)
    cut = np.zeros(NT,dtype=bool); cut[in_c] = is_cut_c[pc[in_c]]
    fall = np.zeros(NT,dtype=bool); fall[in_c] = cstat[pc[in_c]]==ST_FALLBACK
    drop = np.zeros(NT,dtype=bool); drop[in_c] = (cstat[pc[in_c]]==ST_CUT) & ~is_cut_c[pc[in_c]]
    air = lab[T].astype(bool)
    inR = cut | (air & ~drop)
    kap = np.ones(NT); kap[cut] = ckap[pc[cut]]
    est = np.ones((NT,6)); est[cut] = cbeta[pc[cut]]
    adj_T = np.ones((NT,6),dtype=bool); adj_T[in_b] = adj[pb[in_b]]

    # neighbour attributes (neighbours outside T are plain nodes: open links, label from lab)
    nbr = T[:,None]+off[None,:]
    pn_,in_T = _lookup(nbr.ravel(),T)
    pn_ = pn_.reshape(NT,6); in_T = in_T.reshape(NT,6)
    j_cut = np.where(in_T,cut[pn_],False)
    j_fall = np.where(in_T,fall[pn_],False)
    j_inR = np.where(in_T,inR[pn_],lab[nbr].astype(bool))
    kopp = np.arange(6)^1
    j_est = np.where(in_T,est[pn_,kopp[None,:]],1.0)

    beta = np.where(inR[:,None]!=j_inR,0.0,
           np.where(~inR[:,None],adj_T.astype(np.float64),
           np.where(fall[:,None] | j_fall | (~cut[:,None] & ~j_cut),adj_T.astype(np.float64),
                    0.5*(est+j_est))))

    # stability: small cut cells borrow volume from cells with spare volume within LEND_HOPS
    # open faces (total volume unchanged, mass moves O(h): 2nd order). Shrinking their faces
    # or merging them with a neighbour instead moves the effective wall by O(h) (1st order;
    # A4 measured -7 dB vs -18.6 dB at PPW 20.6). Cells that find no lender keep the
    # fallback: their faces are scaled down until stable.
    cfl_fac = l2*(1.0+STAB_MARGIN)
    ic = np.flatnonzero(cut)
    short = 2.0*kap[ic]<cfl_fac*beta[ic].sum(axis=-1)
    order = ic[short][np.argsort(kap[ic][short],kind='stable')]
    kap0 = kap
    kap,deficit = _lend_volume(beta,pn_,in_T,inR,kap,order,cfl_fac,LEND_HOPS)
    S = beta.sum(axis=-1)
    scale = np.where(deficit>0.0,np.minimum(1.0,2.0*kap/(cfl_fac*np.maximum(S,1e-300))),1.0)
    j_s = np.where(in_T,scale[pn_],1.0)
    beta = beta*np.minimum(scale[:,None],j_s)
    _print(f'stability: {order.size} small cut cells, {float(np.sum(np.maximum(kap-kap0,0.0))):.4g} cell volumes lent, '
           f'{int(np.sum(deficit>0.0))} cells with scaled-down faces')

    # symmetry: every link must agree with its reverse
    rev = np.where(in_T,beta[pn_,kopp[None,:]],1.0)
    assert np.all(beta==rev), 'asymmetric cut-cell links'

    keep = np.any(beta!=1.0,axis=-1) | (kap!=1.0)
    # materials: cut cells from the triangle areas inside them, the rest from the staircase
    mat = np.full(NT,-1,dtype=np.int8)
    saf = np.zeros(NT)
    mat[in_b] = mat_v[pb[in_b]]
    unor = rg.tris_pre['unor'][tidx_v]
    fac = np.zeros((NT,6))
    fac[in_b] = np.abs(unor[pb[in_b]][:,[0,0,1,1,2,2]])
    stair = (~adj_T) & ~j_cut
    saf = np.sum(stair*fac,axis=-1)
    mat[saf==0.0] = -1
    mat[~in_b] = -1

    p_mat = rg.mat_ind[p_tri]
    p_air = tri_air[p_tri]
    p_lossy = (p_mat>=0) & (((tri_side[p_tri]==1) & (p_air==AIR_BACK)) | ((tri_side[p_tri]==2) & (p_air==AIR_FRONT)))
    p_cell = np.searchsorted(cells,p_node)
    Nm = max(int(rg.Nmat),1)
    acc = np.zeros((cells.size,Nm))
    np.add.at(acc,(p_cell[p_lossy],p_mat[p_lossy]),parea[p_lossy])
    c_mat = np.where(acc.max(axis=-1)>0,np.argmax(acc,axis=-1),-1).astype(np.int8)
    c_saf = acc.max(axis=-1)/(h*h)
    mat[cut] = c_mat[pc[cut]]
    saf[cut] = c_saf[pc[cut]]
    mat[np.all(beta==0.0,axis=-1)] = -1
    saf[mat<0] = 0.0

    sel = np.flatnonzero(keep)
    vox_scene.bn_ixyz = T[sel]
    vox_scene.beta_bn = np.ascontiguousarray(beta[sel])
    vox_scene.vol_bn = kap[sel]
    vox_scene.adj_bn = vox_scene.beta_bn>0.0
    vox_scene.mat_bn = mat[sel]
    vox_scene.saf_bn = saf[sel]
    vox_scene.tidx_bn = None

    # report: air volume represented vs. the mesh volume
    Vgrid = (float(lab.sum()) - float(air.sum()) + float(kap[inR].sum()))*h**3
    _print(f'Nb: {bn.size} (staircase) -> {sel.size} (cut cells); air volume on grid {Vgrid:.9g} m^3, '
           f'mesh {abs(rg.vol):.9g} m^3')
    vox_scene.air_leak = None if n_edge==0 else {
        'edge_nodes': n_edge, 'air_volume_m3': Vgrid, 'mesh_volume_m3': float(abs(rg.vol))}
