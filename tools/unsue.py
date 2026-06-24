import zlib, sys, struct
def extract(path):
    data = open(path,'rb').read()
    if data[:4] != b'FZFS':
        return None
    # find first zlib header (78 01/9c/da)
    for i in range(4, 32):
        if data[i] == 0x78 and data[i+1] in (0x01,0x9c,0xda):
            try:
                raw = zlib.decompress(data[i:])
                return raw
            except Exception as e:
                # try decompressobj (trailing garbage)
                try:
                    d = zlib.decompressobj()
                    raw = d.decompress(data[i:])
                    return raw
                except Exception as e2:
                    return ('ERR', str(e2))
    return ('NOZLIB',)
if __name__=='__main__':
    for p in sys.argv[1:]:
        r = extract(p)
        if isinstance(r, tuple):
            print(p, "->", r); continue
        if r is None:
            print(p, "-> not FZFS"); continue
        out = '/tmp/under-test/sue_out/'+p.split('/')[-1]+'.bin'
        import os; os.makedirs('/tmp/under-test/sue_out', exist_ok=True)
        open(out,'wb').write(r)
        print(f"{p} -> {len(r)} bytes decompressed -> {out}")
