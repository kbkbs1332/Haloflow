#!/usr/bin/env python3
"""把扩展目录打成 CRX3 并自检"""
import os, sys, json, struct, hashlib, subprocess, zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))   # 仓库根目录
SRC = os.path.join(ROOT, 'extension')
EXCLUDE_DIRS = {'__pycache__', '.git'}
EXCLUDE_FILES = {'.DS_Store', 'README.md', 'PROJECT.md'}
EXCLUDE_PREFIX = ('preview-', 'test-')


def make_zip(out_zip, dev=False):
    if os.path.exists(out_zip):
        os.remove(out_zip)
    with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for root, dirs, files in os.walk(SRC):
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for f in files:
                if f in EXCLUDE_FILES or f.startswith(EXCLUDE_PREFIX):
                    continue
                # 根目录下的截图/测试产物一律不进包（icons/ 里的保留）
                if os.path.abspath(root) == os.path.abspath(SRC) and f.lower().endswith(('.png', '.jpg', '.jpeg')):
                    continue
                if f.endswith(('.py', '.zip', '.crx', '.bak', '.sh')):
                    continue
                full = os.path.join(root, f)
                rel = os.path.relpath(full, SRC).replace(os.sep, '/')
                if rel == 'manifest.json' and dev:
                    mf = json.load(open(full, encoding='utf-8'))
                    mf['name'] = mf.get('name', 'HaloFlow') + ' · Dev'
                    mf['version'] = mf.get('version', '1.0.0') + '.1'
                    z.writestr('manifest.json', json.dumps(mf, ensure_ascii=False, indent=2))
                    continue
                z.write(full, rel)
    return out_zip


def varint(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        if n:
            out.append(b | 0x80)
        else:
            out.append(b)
            return bytes(out)


def pb(field, data):
    return varint((field << 3) | 2) + varint(len(data)) + data


def main():
    dev = '--dev' in sys.argv
    work = os.path.dirname(os.path.abspath(__file__))
    key = os.path.join(work, 'haloflow_dev_key.pem' if dev else 'haloflow_key.pem')
    zpath = os.path.join(work, 'haloflow-dev.zip' if dev else 'haloflow.zip')
    crx = os.path.join(work, 'haloflow-dev.crx' if dev else 'haloflow.crx')

    make_zip(zpath, dev)

    if not os.path.exists(key):
        subprocess.run(['openssl', 'genrsa', '-out', key, '2048'], check=True, capture_output=True)
    os.chmod(key, 0o600)

    pem = subprocess.run(['openssl', 'rsa', '-in', key, '-pubout'], check=True, capture_output=True).stdout
    pub = subprocess.run(['openssl', 'rsa', '-pubin', '-outform', 'DER'], input=pem,
                         check=True, capture_output=True).stdout
    crx_id = hashlib.sha256(pub).digest()[:16]
    shd = pb(1, crx_id)

    zipdata = open(zpath, 'rb').read()
    to_sign = b'CRX3 SignedData\x00' + struct.pack('<I', len(shd)) + shd + zipdata
    sig = subprocess.run(['openssl', 'dgst', '-sha256', '-sign', key], input=to_sign,
                         check=True, capture_output=True).stdout

    header = pb(2, pb(1, pub) + pb(2, sig)) + pb(10000, shd)
    blob = b'Cr24' + struct.pack('<I', 3) + struct.pack('<I', len(header)) + header + zipdata
    open(crx, 'wb').write(blob)

    ext_id = ''.join(chr(ord('a') + (b >> 4)) + chr(ord('a') + (b & 0xF)) for b in crx_id)
    print(json.dumps({
        'dev': dev, 'crx': crx, 'size': len(blob), 'zip_size': len(zipdata),
        'files': len(zipfile.ZipFile(zpath).namelist()),
        'extension_id': ext_id
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
