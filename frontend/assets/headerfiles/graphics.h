// pc_bgi.h — a tiny, header-only, Polycode-friendly substitute for <graphics.h>
//
// ✦ What it gives you (BGI-like):
//   - initwindow(w,h,title), initgraph(...), closegraph()
//   - setcolor(), setbkcolor(), cleardevice()
//   - putpixel(), getpixel()
//   - line(), rectangle(), bar(), circle(), ellipse(), fillellipse()
//   - arc()  (coarse polyline approximation)
//   - moveto(), lineto(), getx(), gety()
//   - floodfill() (simple stack-based, uses current fill color)
//   - writeimagefile("name.ppm")  → saves PPM (P6) image
//
// ✦ What is stubbed / minimal (to keep this portable):
//   - setlinestyle(), setfillstyle(): limited (solid only)
//   - outtextxy(): optional tiny bitmap font (enable PC_BGI_ENABLE_TEXT)
//   - delay(): portable sleep
//   - No window opens; drawing goes to an offscreen buffer.
//
// ✦ Usage (C or C++):
//   #include "pc_bgi.h"
//   int main(){
//     initwindow(640,480, "demo");
//     setbkcolor(LIGHTCYAN); cleardevice();
//     setcolor(RED); circle(320,240, 100);
//     bar(100,380, 540, 420);
//     writeimagefile("frame.ppm");
//     closegraph();
//   }
//
// Your Polycode page already knows how to preview .ppm files.
// If you really need PNG, you can convert client-side, or
// ask for the PNG add-on version later.

#ifndef PC_BGI_H
#define PC_BGI_H

#ifdef __cplusplus
extern "C" {
#endif

/* ——— types & macros ——— */
typedef unsigned char  pc_u8;
typedef unsigned int   pc_u32;   /* 0xRRGGBB */

enum {
  /* classic 16 VGA-ish BGI colors */
  BLACK=0, BLUE, GREEN, CYAN, RED, MAGENTA, BROWN, LIGHTGRAY,
  DARKGRAY, LIGHTBLUE, LIGHTGREEN, LIGHTCYAN, LIGHTRED,
  LIGHTMAGENTA, YELLOW, WHITE
};

/* ——— internal state ——— */
static struct {
  int    w, h;
  pc_u32 *pix;      /* row-major, 0xRRGGBB */
  pc_u32  fg, bg;   /* current color */
  int     pen_x, pen_y; /* for moveto/lineto */
} _pc;

/* ——— helpers ——— */
static pc_u32 _pc_from_bgi_color(int c){
  switch (c & 15){
    case BLACK: return 0x000000; case BLUE: return 0x0000AA; case GREEN: return 0x00AA00;
    case CYAN: return 0x00AAAA; case RED: return 0xAA0000; case MAGENTA: return 0xAA00AA;
    case BROWN: return 0xAA5500; case LIGHTGRAY: return 0xAAAAAA; case DARKGRAY: return 0x555555;
    case LIGHTBLUE: return 0x5555FF; case LIGHTGREEN: return 0x55FF55; case LIGHTCYAN: return 0x55FFFF;
    case LIGHTRED: return 0xFF5555; case LIGHTMAGENTA: return 0xFF55FF; case YELLOW: return 0xFFFF55;
    default: return 0xFFFFFF; /* WHITE */
  }
}

static void _pc_put(int x,int y, pc_u32 rgb){
  if ((unsigned)x >= (unsigned)_pc.w || (unsigned)y >= (unsigned)_pc.h) return;
  _pc.pix[(size_t)y * (size_t)_pc.w + (size_t)x] = rgb;
}
static pc_u32 _pc_get(int x,int y){
  if ((unsigned)x >= (unsigned)_pc.w || (unsigned)y >= (unsigned)_pc.h) return 0;
  return _pc.pix[(size_t)y * (size_t)_pc.w + (size_t)x];
}

/* ——— init / shutdown ——— */
static void initwindow(int w,int h, const char* /*title*/){
  if (w<=0) w=640; if (h<=0) h=480;
  _pc.w = w; _pc.h = h; _pc.fg = 0xFFFFFF; _pc.bg = 0x000000;
  _pc.pen_x=0; _pc.pen_y=0;
  _pc.pix = (pc_u32*)malloc((size_t)w*(size_t)h*sizeof(pc_u32));
  if (_pc.pix){
    for (int i=0;i<w*h;i++) _pc.pix[i] = _pc.bg;
  }
}

static void initgraph(int* gd, int* gm, const char* path){ (void)gd; (void)gm; (void)path; initwindow(640,480, ""); }

static void closegraph(void){ if (_pc.pix){ free(_pc.pix); _pc.pix=NULL; } _pc.w=_pc.h=0; }

/* ——— state ——— */
static void setcolor(int c){ _pc.fg = _pc_from_bgi_color(c); }
static void setbkcolor(int c){ _pc.bg = _pc_from_bgi_color(c); }
static void cleardevice(void){ if (_pc.pix) for (int i=0;i<_pc.w*_pc.h;i++) _pc.pix[i]=_pc.bg; }

/* ——— pixels ——— */
static void putpixel(int x,int y,int color){ _pc_put(x,y,_pc_from_bgi_color(color)); }
static int  getpixel(int x,int y){ pc_u32 c=_pc_get(x,y); return (int)c; }

/* ——— lines ——— */
static void line(int x0,int y0,int x1,int y1){
  int dx = (x1>x0)?(x1-x0):(x0-x1), sx = (x0<x1)?1:-1;
  int dy = (y1>y0)?(y0-y1):(y1-y0), sy = (y0<y1)?1:-1; // note: negative
  int err = dx + dy;
  for(;;){ _pc_put(x0,y0,_pc.fg); if (x0==x1 && y0==y1) break; int e2 = err<<1; if (e2>=dy){ err+=dy; x0+=sx; } if (e2<=dx){ err+=dx; y0+=sy; } }
}

static void rectangle(int left,int top,int right,int bottom){
  line(left,top,right,top); line(right,top,right,bottom);
  line(right,bottom,left,bottom); line(left,bottom,left,top);
}

static void bar(int left,int top,int right,int bottom){
  if (left>right){ int t=left; left=right; right=t; }
  if (top>bottom){ int t=top; top=bottom; bottom=t; }
  if (left<0) left=0; if (top<0) top=0; if (right>=_pc.w) right=_pc.w-1; if (bottom>=_pc.h) bottom=_pc.h-1;
  for (int y=top; y<=bottom; ++y){
    size_t k = (size_t)y * (size_t)_pc.w + (size_t)left;
    for (int x=left; x<=right; ++x) _pc.pix[k++] = _pc.fg;
  }
}

/* ——— circles/ellipses ——— */
static void circle(int xc,int yc,int r){
  if (r<=0) return; int x= r, y=0, err=0;
  while (x>=y){
    _pc_put(xc+x,yc+y,_pc.fg); _pc_put(xc+y,yc+x,_pc.fg);
    _pc_put(xc-y,yc+x,_pc.fg); _pc_put(xc-x,yc+y,_pc.fg);
    _pc_put(xc-x,yc-y,_pc.fg); _pc_put(xc-y,yc-x,_pc.fg);
    _pc_put(xc+y,yc-x,_pc.fg); _pc_put(xc+x,yc-y,_pc.fg);
    y++; if (err<=0){ err += 2*y + 1; } if (err>0){ x--; err -= 2*x + 1; }
  }
}

static void ellipse(int xc,int yc,int xr,int yr){
  if (xr<=0 || yr<=0) return;
  for (int t=0; t<360; ++t){
    double a = t * 3.14159265358979323846 / 180.0;
    int x = (int)(xc + xr * cos(a) + 0.5);
    int y = (int)(yc + yr * sin(a) + 0.5);
    _pc_put(x,y,_pc.fg);
  }
}

static void fillellipse(int xc,int yc,int xr,int yr){
  if (xr<=0 || yr<=0) return;
  for (int y=-yr; y<=yr; ++y){
    double t = 1.0 - (double)(y*y)/(double)(yr*yr);
    if (t<0) continue; int dx = (int)(xr * sqrt(t) + 0.5);
    for (int x=-dx; x<=dx; ++x) _pc_put(xc+x, yc+y, _pc.fg);
  }
}

static void arc(int xc,int yc,int stAngle,int endAngle,int r){
  if (r<=0) return; if (endAngle<stAngle){ int t=stAngle; stAngle=endAngle; endAngle=t; }
  int prevx=0, prevy=0; int first=1;
  for (int a=stAngle; a<=endAngle; ++a){
    double rad = a * 3.14159265358979323846 / 180.0;
    int x = (int)(xc + r*cos(rad) + 0.5);
    int y = (int)(yc + r*sin(rad) + 0.5);
    if (!first){ line(prevx,prevy,x,y); } else { _pc_put(x,y,_pc.fg); first=0; }
    prevx=x; prevy=y;
  }
}

/* ——— pen-based ——— */
static void moveto(int x,int y){ _pc.pen_x=x; _pc.pen_y=y; }
static void lineto(int x,int y){ line(_pc.pen_x,_pc.pen_y,x,y); _pc.pen_x=x; _pc.pen_y=y; }
static int  getx(void){ return _pc.pen_x; }
static int  gety(void){ return _pc.pen_y; }

/* ——— flood fill ——— */
static void floodfill(int x,int y,int /*boundaryOrOld*/){
  /* BGI semantics vary. Here we do: fill all connected pixels equal to the start color with current fg. */
  if ((unsigned)x>=(unsigned)_pc.w || (unsigned)y>=(unsigned)_pc.h) return;
  pc_u32 src = _pc_get(x,y); pc_u32 dst = _pc.fg; if (src==dst) return;
  typedef struct {int x,y;} Node;
  int cap = 1<<14; Node* st=(Node*)malloc(sizeof(Node)*cap); int sp=0; st[sp++] = (Node){x,y};
  while (sp){ Node n = st[--sp]; int nx=n.x, ny=n.y; if ((unsigned)nx>=(unsigned)_pc.w || (unsigned)ny>=(unsigned)_pc.h) continue; if (_pc_get(nx,ny)!=src) continue; _pc_put(nx,ny,dst);
    if (sp+4 >= cap){ cap*=2; st=(Node*)realloc(st,sizeof(Node)*cap); }
    st[sp++] = (Node){nx+1,ny}; st[sp++] = (Node){nx-1,ny}; st[sp++] = (Node){nx,ny+1}; st[sp++] = (Node){nx,ny-1};
  }
  free(st);
}

/* ——— minimal styles (no-ops kept for compatibility) ——— */
static void setlinestyle(int /*type*/, unsigned /*pattern*/, int /*thickness*/){ /* solid only */ }
static void setfillstyle(int /*pattern*/, int /*color*/){ /* use setcolor before bar/fillellipse */ }

/* ——— optional text (tiny 5x7 font) ——— */
#ifdef PC_BGI_ENABLE_TEXT
static const pc_u8 _pc_font5x7[96][5] = { /* ASCII 32..127, left-to-right columns */
  /* space.. */ {0,0,0,0,0}, {0x04,0x04,0x04,0x00,0x04}, {0x0A,0x0A,0x00,0x00,0x00}, {0x0A,0x1F,0x0A,0x1F,0x0A},
  {0x04,0x0E,0x14,0x0E,0x04}, {0x19,0x19,0x02,0x04,0x13}, {0x0C,0x12,0x0C,0x12,0x0D}, {0x06,0x04,0x08,0,0},
  {0x02,0x04,0x04,0x04,0x02}, {0x08,0x04,0x04,0x04,0x08}, {0x00,0x0A,0x04,0x0A,0x00}, {0x00,0x04,0x0E,0x04,0x00},
  {0,0,0,0x04,0x08}, {0x00,0x00,0x0E,0x00,0x00}, {0,0,0,0x0C,0x0C}, {0x01,0x02,0x04,0x08,0x10},
  {0x0E,0x13,0x15,0x19,0x0E}, {0x04,0x0C,0x04,0x04,0x0E}, {0x0E,0x11,0x02,0x04,0x1F}, {0x1F,0x02,0x04,0x02,0x1F},
  {0x02,0x06,0x0A,0x1F,0x02}, {0x1F,0x10,0x1E,0x01,0x1E}, {0x06,0x08,0x1E,0x11,0x0E}, {0x1F,0x01,0x02,0x04,0x04},
  {0x0E,0x11,0x0E,0x11,0x0E}, {0x0E,0x11,0x0F,0x01,0x0C}, {0,0x0C,0x0C,0,0x0C}, {0,0x0C,0x0C,0,0x0C},
  {0x02,0x04,0x08,0x04,0x02}, {0x00,0x0E,0x00,0x0E,0x00}, {0x08,0x04,0x02,0x04,0x08}, {0x0E,0x11,0x02,0x00,0x04},
  {0x0E,0x11,0x17,0x15,0x0E}, {0x0E,0x11,0x1F,0x11,0x11}, {0x1E,0x11,0x1E,0x11,0x1E}, {0x0E,0x11,0x10,0x11,0x0E},
  {0x1E,0x11,0x11,0x11,0x1E}, {0x1F,0x10,0x1E,0x10,0x1F}, {0x1F,0x10,0x1E,0x10,0x10}, {0x0F,0x10,0x17,0x11,0x0F},
  {0x11,0x11,0x1F,0x11,0x11}, {0x0E,0x04,0x04,0x04,0x0E}, {0x01,0x01,0x01,0x11,0x0E}, {0x11,0x12,0x1C,0x12,0x11},
  {0x10,0x10,0x10,0x10,0x1F}, {0x11,0x1B,0x15,0x11,0x11}, {0x11,0x19,0x15,0x13,0x11}, {0x0E,0x11,0x11,0x11,0x0E},
  {0x1E,0x11,0x1E,0x10,0x10}, {0x0E,0x11,0x11,0x15,0x0E}, {0x1E,0x11,0x1E,0x12,0x11}, {0x0F,0x10,0x0E,0x01,0x1E},
  {0x1F,0x04,0x04,0x04,0x04}, {0x11,0x11,0x11,0x11,0x0E}, {0x11,0x11,0x0A,0x0A,0x04}, {0x11,0x11,0x15,0x1B,0x11},
  {0x11,0x0A,0x04,0x0A,0x11}, {0x11,0x0A,0x04,0x04,0x04}, {0x1F,0x02,0x04,0x08,0x1F}, {0x0E,0x08,0x08,0x08,0x0E},
  {0x10,0x08,0x04,0x02,0x01}, {0x0E,0x02,0x02,0x02,0x0E}, {0x04,0x0A,0x11,0,0}, {0,0,0,0,0x1F}, {0x08,0x04,0,0,0},
  {0x00,0x0E,0x01,0x0F,0x0F}, {0x10,0x1E,0x11,0x11,0x1E}, {0x00,0x0F,0x10,0x10,0x0F}, {0x01,0x0F,0x11,0x11,0x0F},
  {0x0E,0x15,0x1C,0x10,0x0F}, {0x06,0x08,0x1E,0x08,0x08}, {0x0F,0x11,0x0F,0x01,0x0E}, {0x10,0x1E,0x11,0x11,0x11},
  {0x04,0x00,0x0C,0x04,0x0E}, {0x02,0x00,0x02,0x12,0x0C}, {0x10,0x12,0x1C,0x12,0x11}, {0x0C,0x04,0x04,0x04,0x0E},
  {0x00,0x1B,0x15,0x15,0x15}, {0x00,0x1E,0x11,0x11,0x11}, {0x0E,0x11,0x11,0x11,0x0E}, {0x1E,0x11,0x1E,0x10,0x10},
  {0x0F,0x11,0x0F,0x01,0x01}, {0x00,0x1A,0x14,0x10,0x10}, {0x0F,0x10,0x0E,0x01,0x1E}, {0x08,0x1E,0x08,0x08,0x06},
  {0x00,0x11,0x11,0x11,0x0F}, {0x00,0x11,0x11,0x0A,0x04}, {0x00,0x11,0x15,0x1B,0x11}, {0x00,0x11,0x0A,0x11,0x11},
  {0x11,0x11,0x0F,0x01,0x0E}, {0x1F,0x02,0x04,0x08,0x1F}
};
static void outtextxy(int x,int y,const char* s){ if(!s) return; for (int i=0; s[i]; ++i){ unsigned ch=(unsigned char)s[i]; if (ch<32||ch>127){ x+=6; continue; } const pc_u8* g=_pc_font5x7[ch-32]; for (int cx=0; cx<5; ++cx){ pc_u8 col=g[cx]; for (int cy=0; cy<7; ++cy){ if (col & (1u<<cy)) _pc_put(x+cx, y+cy, _pc.fg); } } x+=6; }
}
#else
static void outtextxy(int /*x*/,int /*y*/,const char* /*s*/){ /* disabled: define PC_BGI_ENABLE_TEXT to enable */ }
#endif

/* ——— delay ——— */
static void delay(unsigned ms){
#if defined(_WIN32)
  Sleep(ms);
#else
  struct timespec ts; ts.tv_sec = ms/1000; ts.tv_nsec = (long)(ms%1000)*1000000L; nanosleep(&ts,NULL);
#endif
}

/* ——— PPM writer (P6, binary) ——— */
static int writeimagefile(const char* path){
  if (!_pc.pix || !path) return 0;
  FILE* f = fopen(path, "wb"); if (!f) return 0;
  fprintf(f, "P6\n%d %d\n255\n", _pc.w, _pc.h);
  for (int y=0;y<_pc.h;++y){
    for (int x=0;x<_pc.w;++x){
      pc_u32 c = _pc.pix[(size_t)y*(size_t)_pc.w + (size_t)x];
      unsigned char rgb[3] = { (unsigned char)((c>>16)&255), (unsigned char)((c>>8)&255), (unsigned char)(c&255) };
      fwrite(rgb,1,3,f);
    }
  }
  fclose(f);
  /* optional helper: also print a hint your shell can catch (legacy mode) */
  /* printf("[image] %s\n", path); */
  return 1;
}

#ifdef __cplusplus
}
#endif

/* minimal includes */
#include <stdlib.h>
#include <stdio.h>
#include <math.h>
#if !defined(_WIN32)
  #include <time.h>
#endif

#endif /* PC_BGI_H */
