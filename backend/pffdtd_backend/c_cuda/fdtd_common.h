// vim: tabstop=3: ai
///////////////////////////////////////////////////////////////////////////////
// This file is a part of PFFDTD.
//
// PFFTD is released under the MIT License.
// For details see the LICENSE file.
//
// Copyright 2021 Brian Hamilton.
//
// File name: fdtd_common.h
//
// Description: Header-only misc function definitions related to FDTD simulation
//
///////////////////////////////////////////////////////////////////////////////

#ifndef _FDTD_COMMON_H
#define _FDTD_COMMON_H
#ifndef _STDINT_H
#include <stdint.h> 
#endif
#ifndef _STRING_H
#include <string.h> 
#endif
#ifndef _MATH_H
#include <math.h> 
#endif
#ifndef _FLOAT_H
#include <float.h> 
#endif
#ifndef _TIME_H
#include <time.h> //date and time
#endif
#ifndef _OMP_H
#include <omp.h>
#endif
// compas: removed <sys/ioctl.h> (POSIX only); progress is printed as parseable lines instead
#ifndef _HELPER_FUNCS_H
#include <helper_funcs.h> 
#endif

//flag passed in at compilation (see Makefile)
#if PRECISION==2 //double
   typedef double Real;

   #define REAL_MAX_EXP DBL_MAX_EXP
   #define REAL_MIN_EXP DBL_MIN_EXP

   //using CUDA math intrinsics
   #define FMA_O __fma_rn 
   #define FMA_D __fma_rn
   #define ADD_O __dadd_rn
   #define ADD_D __dadd_rn
   #define EPS 0.0

#elif PRECISION==1 //float with safeguards
   typedef float Real;

   #define REAL_MAX_EXP FLT_MAX_EXP
   #define REAL_MIN_EXP FLT_MIN_EXP

   //using CUDA math intrinsics
   #define FMA_O __fmaf_rz //off-diag
   #define FMA_D __fmaf_rn //diag
   #define ADD_O __fadd_rz
   #define ADD_D __fadd_rn
   #define EPS 1.19209289e-07 //helps with stability in single
#else
   #error "PRECISION = 1 (single) or 2 (double)"
#endif

//declarations, defs below
void ind2sub3d(int64_t idx, int64_t Nx, int64_t Ny, int64_t Nz, int64_t *ix, int64_t *iy, int64_t *iz);
void check_inside_grid(int64_t *idx, int64_t N, int64_t Nx, int64_t Ny, int64_t Nz);
void print_progress(uint32_t n, uint32_t Nt, uint64_t Npts, uint64_t Nb, 
                     double time_elapsed, double time_elapsed_sample, 
                     double time_elapsed_air, double time_elapsed_sample_air, 
                     double time_elapsed_bn, double time_elapsed_sample_bn, int num_workers);


//linear indices to sub-indices in 3d, Nz continguous
void ind2sub3d(int64_t idx, int64_t Nx, int64_t Ny, int64_t Nz, int64_t *ix, int64_t *iy, int64_t *iz) {
   *iz = idx % Nz;
   *iy = (idx - (*iz))/Nz%Ny;
   *ix = ((idx - (*iz))/Nz-(*iy))/Ny;
   assert(*ix>0);
   assert(*iy>0);
   assert(*iz>0);
   assert(*ix<Nx-1);
   assert(*iy<Ny-1);
   assert(*iz<Nz-1);
}

//double check some index inside grid
void check_inside_grid(int64_t *idx, int64_t N, int64_t Nx, int64_t Ny, int64_t Nz) {
   for (int64_t i=0; i<N; i++) {
      int64_t iz,iy,ix;
      ind2sub3d(idx[i], Nx, Ny, Nz, &ix, &iy, &iz);
   }
}

// compas: replaced the ANSI/ioctl progress bar (Linux-only, breaks piped logs) with
// machine-parseable lines: "PFFDTD_PROGRESS <pct> <elapsed_s> <eta_s> <Mvox/s>", printed every ~1%.
void print_progress(uint32_t n, uint32_t Nt, uint64_t Npts, uint64_t Nb, 
                     double time_elapsed, double time_elapsed_sample, 
                     double time_elapsed_air, double time_elapsed_sample_air, 
                     double time_elapsed_bn, double time_elapsed_sample_bn, int num_workers) {
   (void)Nb; (void)time_elapsed_sample; (void)time_elapsed_air; (void)time_elapsed_sample_air;
   (void)time_elapsed_bn; (void)time_elapsed_sample_bn; (void)num_workers;
   uint32_t stride = (Nt>=100) ? (Nt/100) : 1;
   if ((n%stride != 0) && (n != Nt-1)) return;
   double pcnt = (100.0*(n+1))/Nt;
   double est_total = (n>0) ? time_elapsed*Nt/n : 0.0;
   double mvox = (time_elapsed>0.0) ? 1e-6*(double)Npts*n/time_elapsed : 0.0;
   printf("PFFDTD_PROGRESS %.2f %.3f %.3f %.1f\n", pcnt, time_elapsed, est_total-time_elapsed, mvox);
   fflush(stdout);
}
#endif
