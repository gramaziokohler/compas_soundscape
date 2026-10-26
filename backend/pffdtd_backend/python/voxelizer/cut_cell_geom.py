##############################################################################
# compas: numba geometry kernels for the cut-cell boundaries (see cut_cells.py):
# triangle/cell overlap, triangle air sides, and per-cell volume and face fractions
# by convex clipping of the cell against the wall half-spaces. Not part of upstream PFFDTD.
##############################################################################

import numpy as np
from numpy import array as npa
import numba as nb

CUT_TOL = 1e-9       # walls are shifted into the air by CUT_TOL*h (faces lying on a wall are closed)
SNAP_TOL = 1e-7      # kappa/beta within this of 0 or 1 are snapped (>> the CUT_TOL shift)
MODE_TOL = 1e-6      # relative to h, for convex/reflex classification
PLANE_TOL = 1e-9     # coplanarity tolerance (normal dot and offset / h)
MIN_AREA = 1e-12     # relative to h^2: triangles touching a cell in less are ignored
UNION_MIN_DOT = -0.5 # reflex cells whose wall normals are more opposed are slabs -> fallback
MAXV = 48            # max polygon vertices during clipping
MAXP = 16            # max distinct planes per cell
AIR_FRONT, AIR_BACK, AIR_NONE, AIR_THIN = 1, -1, 0, 2
ST_CUT, ST_NOPLANE, ST_FALLBACK = 0, 1, 2

################################################################################
# geometry helpers (numba)
################################################################################

@nb.njit
def _dot(a,b):
    return a[0]*b[0]+a[1]*b[1]+a[2]*b[2]


@nb.njit
def _clip(P,nv,n,d,Q):
    """Sutherland-Hodgman: keep the part of convex polygon P[:nv] with n.x >= d, into Q."""
    m = 0
    if nv==0:
        return 0
    for i in range(nv):
        j = i+1 if i+1<nv else 0
        si = n[0]*P[i,0]+n[1]*P[i,1]+n[2]*P[i,2]-d
        sj = n[0]*P[j,0]+n[1]*P[j,1]+n[2]*P[j,2]-d
        if si>=0.0:
            Q[m,0] = P[i,0]; Q[m,1] = P[i,1]; Q[m,2] = P[i,2]
            m += 1
        if (si>=0.0)!=(sj>=0.0):
            t = si/(si-sj)
            Q[m,0] = P[i,0]+t*(P[j,0]-P[i,0])
            Q[m,1] = P[i,1]+t*(P[j,1]-P[i,1])
            Q[m,2] = P[i,2]+t*(P[j,2]-P[i,2])
            m += 1
    return m


@nb.njit
def _poly_area(P,nv):
    if nv<3:
        return 0.0
    cx = 0.0; cy = 0.0; cz = 0.0
    for i in range(1,nv-1):
        ax = P[i,0]-P[0,0]; ay = P[i,1]-P[0,1]; az = P[i,2]-P[0,2]
        bx = P[i+1,0]-P[0,0]; by = P[i+1,1]-P[0,1]; bz = P[i+1,2]-P[0,2]
        cx += ay*bz-az*by
        cy += az*bx-ax*bz
        cz += ax*by-ay*bx
    return 0.5*np.sqrt(cx*cx+cy*cy+cz*cz)


@nb.njit
def _clip_box(P,nv,Q,xc,hh):
    """Clip P[:nv] to the closed box xc +/- hh; result in P (Q is scratch)."""
    n = np.zeros(3)
    for ax in range(3):
        for sgn in (1.0,-1.0):
            n[0] = 0.0; n[1] = 0.0; n[2] = 0.0
            n[ax] = sgn
            nv = _clip(P,nv,n,sgn*xc[ax]-hh,Q)
            for i in range(nv):
                P[i,0] = Q[i,0]; P[i,1] = Q[i,1]; P[i,2] = Q[i,2]
    return nv


@nb.njit
def _face_square(f,xc,hh,P):
    """Face f (+x,-x,+y,-y,+z,-z) of the box xc +/- hh as a 4-gon."""
    ax = f//2
    sgn = 1.0 if f%2==0 else -1.0
    b = (ax+1)%3
    c = (ax+2)%3
    us = (1.0,-1.0,-1.0,1.0)
    vs = (1.0,1.0,-1.0,-1.0)
    for i in range(4):
        P[i,ax] = xc[ax]+sgn*hh
        P[i,b] = xc[b]+us[i]*hh
        P[i,c] = xc[c]+vs[i]*hh
    return 4


@nb.njit
def _plane_square(n,d,xc,half,P):
    """Square of half-side `half` in plane n.x = d (|n|=1), centred at the projection of xc."""
    a = 0
    if abs(n[1])<abs(n[a]):
        a = 1
    if abs(n[2])<abs(n[a]):
        a = 2
    e = np.zeros(3)
    e[a] = 1.0
    u = np.array([n[1]*e[2]-n[2]*e[1],n[2]*e[0]-n[0]*e[2],n[0]*e[1]-n[1]*e[0]])
    u /= np.sqrt(_dot(u,u))
    v = np.array([n[1]*u[2]-n[2]*u[1],n[2]*u[0]-n[0]*u[2],n[0]*u[1]-n[1]*u[0]])
    s = d-_dot(n,xc)
    p0 = xc+s*n
    us = (1.0,-1.0,-1.0,1.0)
    vs = (1.0,1.0,-1.0,-1.0)
    for i in range(4):
        for k in range(3):
            P[i,k] = p0[k]+half*(us[i]*u[k]+vs[i]*v[k])
    return 4


@nb.njit
def _axis_test(e0,v0,v1,v2,ax,hh):
    # separating axis e x ax_unit for the triangle/AABB test (Akenine-Moller)
    a = np.zeros(3)
    a[ax] = 1.0
    l0 = e0[1]*a[2]-e0[2]*a[1]
    l1 = e0[2]*a[0]-e0[0]*a[2]
    l2 = e0[0]*a[1]-e0[1]*a[0]
    p0 = l0*v0[0]+l1*v0[1]+l2*v0[2]
    p1 = l0*v1[0]+l1*v1[1]+l2*v1[2]
    p2 = l0*v2[0]+l1*v2[1]+l2*v2[2]
    r = hh*(abs(l0)+abs(l1)+abs(l2))
    mn = min(p0,min(p1,p2))
    mx = max(p0,max(p1,p2))
    return mn>r or mx<-r


@nb.njit
def _tri_box_overlap(T,xc,hh,nrm):
    v0 = T[0]-xc; v1 = T[1]-xc; v2 = T[2]-xc
    for k in range(3):
        if min(v0[k],min(v1[k],v2[k]))>hh or max(v0[k],max(v1[k],v2[k]))<-hh:
            return False
    r = hh*(abs(nrm[0])+abs(nrm[1])+abs(nrm[2]))
    s = _dot(nrm,v0)
    if abs(s)>r:
        return False
    edges = (v1-v0,v2-v1,v0-v2)
    for e in edges:
        for ax in range(3):
            if _axis_test(e,v0,v1,v2,ax,hh):
                return False
    return True


################################################################################
# triangle -> cell pairs, triangle air sides
################################################################################

@nb.njit
def _tri_cells(tri_pts,tri_n,use,o,h,N,hh,fill,out_node,out_tri):
    Nx,Ny,Nz = N[0],N[1],N[2]
    cnt = 0
    xc = np.zeros(3)
    for t in range(tri_pts.shape[0]):
        if not use[t]:
            continue
        T = tri_pts[t]
        n = tri_n[t]
        d = _dot(n,T[0])
        a = 0
        if abs(n[1])>abs(n[a]):
            a = 1
        if abs(n[2])>abs(n[a]):
            a = 2
        b = (a+1)%3
        c = (a+2)%3
        lo = np.zeros(3,dtype=np.int64)
        hi = np.zeros(3,dtype=np.int64)
        for k in range(3):
            mn = min(T[0,k],min(T[1,k],T[2,k]))
            mx = max(T[0,k],max(T[1,k],T[2,k]))
            lo[k] = max(1,int(np.ceil((mn-hh-o[k])/h)))
            hi[k] = min(N[k]-2,int(np.floor((mx+hh-o[k])/h)))
        for ib in range(lo[b],hi[b]+1):
            yb = o[b]+ib*h
            for ic in range(lo[c],hi[c]+1):
                zc = o[c]+ic*h
                amin = np.inf
                amax = -np.inf
                for sb in (-1.0,1.0):
                    for sc in (-1.0,1.0):
                        xa = (d-n[b]*(yb+sb*hh)-n[c]*(zc+sc*hh))/n[a]
                        amin = min(amin,xa)
                        amax = max(amax,xa)
                ka0 = max(lo[a],int(np.ceil((amin-hh-o[a])/h)))
                ka1 = min(hi[a],int(np.floor((amax+hh-o[a])/h)))
                for ka in range(ka0,ka1+1):
                    xc[a] = o[a]+ka*h
                    xc[b] = yb
                    xc[c] = zc
                    if _tri_box_overlap(T,xc,hh,n):
                        if fill:
                            idx = np.zeros(3,dtype=np.int64)
                            idx[a] = ka; idx[b] = ib; idx[c] = ic
                            out_node[cnt] = idx[0]*Ny*Nz+idx[1]*Nz+idx[2]
                            out_tri[cnt] = t
                        cnt += 1
    return cnt


def tri_cell_pairs(tri_pts,tri_n,use,o,h,N):
    """(node, tri) pairs for every cell (closed box, slightly enlarged) a triangle touches."""
    hh = 0.5*h*(1.0+CUT_TOL)
    N = npa(N,dtype=np.int64)
    dummy = np.zeros(0,dtype=np.int64)
    cnt = _tri_cells(tri_pts,tri_n,use,o,h,N,hh,False,dummy,dummy)
    out_node = np.zeros(cnt,dtype=np.int64)
    out_tri = np.zeros(cnt,dtype=np.int64)
    _tri_cells(tri_pts,tri_n,use,o,h,N,hh,True,out_node,out_tri)
    return out_node,out_tri


@nb.njit
def _tri_air_side(tri_pts,tri_n,tri_side,lab,o,h,N):
    Nt = tri_pts.shape[0]
    out = np.zeros(Nt,dtype=np.int8)
    Ny,Nz = N[1],N[2]
    idx = np.zeros(3,dtype=np.int64)
    for t in range(Nt):
        if tri_side[t]==3:
            out[t] = AIR_THIN
            continue
        T = tri_pts[t]
        n = tri_n[t]
        d = _dot(n,T[0])
        a = 0
        if abs(n[1])>abs(n[a]):
            a = 1
        if abs(n[2])>abs(n[a]):
            a = 2
        b = (a+1)%3
        c = (a+2)%3
        cent = (T[0]+T[1]+T[2])/3.0
        vp = 0; vm = 0; vb = 0
        for s in range(4):
            p = cent if s==0 else 0.5*(cent+T[s-1])
            ib = int(np.round((p[b]-o[b])/h))
            ic = int(np.round((p[c]-o[c])/h))
            if ib<1 or ib>N[b]-2 or ic<1 or ic>N[c]-2:
                continue
            xa = (d-n[b]*(o[b]+ib*h)-n[c]*(o[c]+ic*h))/n[a]
            ka_lo = int(np.floor((xa-0.01*h-o[a])/h))
            ka_hi = int(np.ceil((xa+0.01*h-o[a])/h))
            if ka_lo<1 or ka_hi>N[a]-2:
                continue
            idx[b] = ib; idx[c] = ic
            idx[a] = ka_lo
            L_lo = lab[idx[0]*Ny*Nz+idx[1]*Nz+idx[2]]
            idx[a] = ka_hi
            L_hi = lab[idx[0]*Ny*Nz+idx[1]*Nz+idx[2]]
            if n[a]>0:
                Lf = L_hi; Lb = L_lo
            else:
                Lf = L_lo; Lb = L_hi
            if Lf and not Lb:
                vp += 1
            elif Lb and not Lf:
                vm += 1
            elif Lf and Lb:
                vb += 1
        if vp>vm and vp>=vb:
            out[t] = AIR_FRONT
        elif vm>vp and vm>=vb:
            out[t] = AIR_BACK
        elif vb>0:
            out[t] = AIR_THIN
        else:
            out[t] = AIR_NONE
    return out


################################################################################
# per-cell geometry
################################################################################

@nb.njit(parallel=True)
def _cell_geometry(cell_ixyz,ptr,ptri,tri_pts,tri_n,tri_d,tri_air,o,h,N):
    Nc = cell_ixyz.size
    Ny,Nz = N[1],N[2]
    kappa = np.zeros(Nc)
    beta = np.zeros((Nc,6))
    status = np.zeros(Nc,dtype=np.int8)
    parea = np.zeros(ptri.size)
    hh = 0.5*h
    tolh = CUT_TOL*h
    for c in nb.prange(Nc):
        ii = cell_ixyz[c]
        iz = ii%Nz
        iy = (ii//Nz)%Ny
        ix = ii//(Ny*Nz)
        xc = np.array([o[0]+ix*h,o[1]+iy*h,o[2]+iz*h])
        P = np.zeros((MAXV,3))
        Q = np.zeros((MAXV,3))
        pn = np.zeros((MAXP,3))
        pd = np.zeros(MAXP)
        k0 = ptr[c]
        k1 = ptr[c+1]
        tri_plane = np.full(k1-k0,-1,dtype=np.int64)
        tcent = np.zeros((k1-k0,3))
        npl = 0
        st = ST_CUT
        for k in range(k0,k1):
            t = ptri[k]
            for v in range(3):
                P[v,0] = tri_pts[t,v,0]; P[v,1] = tri_pts[t,v,1]; P[v,2] = tri_pts[t,v,2]
            nv = _clip_box(P,3,Q,xc,hh*(1.0+CUT_TOL))
            A = _poly_area(P,nv)
            parea[k] = A
            a = tri_air[t]
            if a==AIR_THIN:
                st = ST_FALLBACK
            if a==AIR_NONE or a==AIR_THIN or A<=MIN_AREA*h*h:
                continue
            for v in range(nv):
                tcent[k-k0] += P[v]
            tcent[k-k0] /= nv
            sg = 1.0 if a==AIR_FRONT else -1.0
            nn = sg*tri_n[t]
            dd = sg*tri_d[t]
            q = -1
            for j in range(npl):
                if _dot(nn,pn[j])>1.0-PLANE_TOL and abs(dd-pd[j])<PLANE_TOL*h:
                    q = j
                    break
            if q<0:
                if npl==MAXP:
                    st = ST_FALLBACK
                    continue
                pn[npl] = nn
                pd[npl] = dd
                q = npl
                npl += 1
            tri_plane[k-k0] = q
        if st==ST_FALLBACK:
            status[c] = ST_FALLBACK
            continue
        if npl==0:
            status[c] = ST_NOPLANE
            continue
        # convex (air = intersection of half-spaces) or reflex (union)?
        inter = True
        if npl>1:
            anypos = False
            anyneg = False
            for k in range(k1-k0):
                p = tri_plane[k]
                if p<0:
                    continue
                for j in range(npl):
                    if j==p:
                        continue
                    s = _dot(pn[j],tcent[k])-pd[j]
                    if s>MODE_TOL*h:
                        anypos = True
                    if s<-MODE_TOL*h:
                        anyneg = True
            if anypos and anyneg:
                status[c] = ST_FALLBACK
                continue
            inter = not anyneg
            if not inter:
                for j in range(npl):
                    for m in range(j+1,npl):
                        if _dot(pn[j],pn[m])<UNION_MIN_DOT:
                            st = ST_FALLBACK
                if st==ST_FALLBACK:
                    status[c] = ST_FALLBACK
                    continue
        # region R = {qn.x >= qd for all planes}: the air (intersection) or its complement (union)
        sg = 1.0 if inter else -1.0
        qn = np.zeros((npl,3))
        qd = np.zeros(npl)
        for j in range(npl):
            qn[j] = sg*pn[j]
            qd[j] = sg*(pd[j]+tolh)
        Af = np.zeros(6)
        for f in range(6):
            nv = _face_square(f,xc,hh,P)
            for j in range(npl):
                nv = _clip(P,nv,qn[j],qd[j],Q)
                for v in range(nv):
                    P[v,0] = Q[v,0]; P[v,1] = Q[v,1]; P[v,2] = Q[v,2]
            Af[f] = _poly_area(P,nv)
        V = 0.0
        for f in range(6):
            V += (hh/3.0)*Af[f]
        for j in range(npl):
            nv = _plane_square(qn[j],qd[j],xc,4.0*h,P)
            nv = _clip_box(P,nv,Q,xc,hh)
            for m in range(npl):
                if m==j:
                    continue
                nv = _clip(P,nv,qn[m],qd[m],Q)
                for v in range(nv):
                    P[v,0] = Q[v,0]; P[v,1] = Q[v,1]; P[v,2] = Q[v,2]
            Ak = _poly_area(P,nv)
            V += (_dot(qn[j],xc)-qd[j])*Ak/3.0
        kap = V/(h*h*h)
        if not inter:
            kap = 1.0-kap
        for f in range(6):
            bf = Af[f]/(h*h)
            if not inter:
                bf = 1.0-bf
            beta[c,f] = bf
        kappa[c] = kap
    # snap and clamp
    for c in nb.prange(Nc):
        kappa[c] = min(1.0,max(0.0,kappa[c]))
        if kappa[c]<SNAP_TOL:
            kappa[c] = 0.0
        if kappa[c]>1.0-SNAP_TOL:
            kappa[c] = 1.0
        for f in range(6):
            b = min(1.0,max(0.0,beta[c,f]))
            if b<SNAP_TOL:
                b = 0.0
            if b>1.0-SNAP_TOL:
                b = 1.0
            beta[c,f] = b
    return kappa,beta,status,parea
