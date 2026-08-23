#!/usr/bin/env python3
"""Validate the British Shorthair GLB against the tree's asset contract."""
import argparse, os, sys
import numpy as np
import trimesh

TRI_MIN, TRI_MAX = 3000, 8000
MAX_BYTES = 1_500_000
HEIGHT_TARGET = 1.0
HEIGHT_TOL = 0.08

def triangles(scene):
    return sum(len(g.faces) for g in scene.geometry.values())

def uv_stats(g):
    uv = getattr(g.visual, 'uv', None)
    if uv is None or len(uv) != len(g.vertices):
        return None
    # UV signed-area test: the dominant orientation must be consistent;
    # a mirrored island shows up as a substantial opposite-sign population.
    f = g.faces
    a,b,c = uv[f[:,0]], uv[f[:,1]], uv[f[:,2]]
    area = (b[:,0]-a[:,0])*(c[:,1]-a[:,1]) - (b[:,1]-a[:,1])*(c[:,0]-a[:,0])
    area = area[np.abs(area)>1e-7]
    pos = np.count_nonzero(area>0); neg=np.count_nonzero(area<0)
    # A few reversed triangles can occur at the cylindrical seam; >10% is a fail.
    mirrored_ratio=min(pos,neg)/max(1,max(pos,neg))
    return uv, mirrored_ratio

def main(path):
    errors=[]; warnings=[]
    size=os.path.getsize(path)
    if size>MAX_BYTES: errors.append(f'file is {size} bytes (> {MAX_BYTES})')
    try: scene=trimesh.load(path,force='scene',process=False)
    except Exception as e: errors.append(f'GLB load failed: {e}'); return errors,warnings
    tris=triangles(scene)
    if not TRI_MIN<=tris<=TRI_MAX: errors.append(f'{tris} triangles (required {TRI_MIN}-{TRI_MAX})')
    lo,hi=scene.bounds; height=float(hi[1]-lo[1])
    if abs(height-HEIGHT_TARGET)>HEIGHT_TOL: errors.append(f'height {height:.3f} (target ~1.00)')
    if abs(lo[1])>0.02: errors.append(f'feet/origin Y is {lo[1]:.3f}, expected ~0')
    if abs(lo[0]+hi[0])>0.08 or abs(lo[2]+hi[2])>0.08: warnings.append('model is not perfectly centred around X/Z origin')

    names=' '.join(scene.geometry.keys()).lower()
    if not any(k in names for k in ('muzzle','nose','face','jowl')):
        errors.append('no identifiable face geometry')
    if not any('eye' in n.lower() for n in scene.geometry): errors.append('no separate eye geometry')

    coat=None
    for n,g in scene.geometry.items():
        if 'coat' in n.lower(): coat=g; break
    if coat is None: errors.append('no coat mesh')
    else:
        us=uv_stats(coat)
        if us is None: errors.append('coat mesh has no complete UV set')
        else:
            uv,mirror=us
            if mirror>0.10: errors.append(f'UV orientation suggests mirroring/reversed islands ({mirror:.1%})')
            # V should broadly track world Y: this is the testable belly->spine rule.
            y=coat.vertices[:,1]
            order=np.argsort(y)
            # Spearman without scipy: rank correlation.
            ry=np.empty_like(order,dtype=float); ry[order]=np.arange(len(order),dtype=float)
            rv=np.empty_like(order,dtype=float); rv[np.argsort(uv[:,1])]=np.arange(len(uv),dtype=float)
            corr=np.corrcoef(ry,rv)[0,1]
            if corr<0.90: errors.append(f'UV V does not follow belly->spine strongly enough (rank r={corr:.3f})')
            # V should span nearly the full texture range.
            if uv[:,1].min()>0.05 or uv[:,1].max()<0.95: warnings.append('coat V does not use most of 0..1')

    # Explicit material names are part of the contract.
    try:
        import struct,json
        b=open(path,'rb').read(); off=12; doc=None
        while off<len(b):
            ln,tp=struct.unpack_from('<II',b,off); dat=b[off+8:off+8+ln]
            if tp==0x4E4F534A: doc=json.loads(dat.decode('utf8').rstrip('\0 ')); break
            off+=8+ln
        mats={m.get('name','') for m in doc.get('materials',[])}
        if 'Eye_Iris' not in mats: errors.append('missing Eye_Iris material')
        if 'Eye_Pupil' not in mats: errors.append('missing Eye_Pupil material')
    except Exception as e: warnings.append(f'could not inspect glTF materials: {e}')
    return errors,warnings

if __name__=='__main__':
    ap=argparse.ArgumentParser(); ap.add_argument('glb'); args=ap.parse_args()
    errors,warnings=main(args.glb)
    print('BSH GLB VALIDATOR')
    print('PASS' if not errors else 'FAIL')
    for w in warnings: print('WARN:',w)
    for e in errors: print('ERROR:',e)
    sys.exit(1 if errors else 0)
