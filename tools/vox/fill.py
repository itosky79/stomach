# 任意のボクセルの内腔で、窪みごとの溜まりとあふれを求める（fill and spill）
import numpy as np, heapq
def neighbors(P, VS):
    key = np.round(P / VS).astype(int); idx = {tuple(k): i for i, k in enumerate(key)}
    return [[idx[t] for t in ((k[0]+1,k[1],k[2]),(k[0]-1,k[1],k[2]),(k[0],k[1]+1,k[2]),(k[0],k[1]-1,k[2]),(k[0],k[1],k[2]+1),(k[0],k[1],k[2]-1)) if t in idx] for k in key]
def settle(P, nb, up, filled0):
    n = len(P); h = P @ up + np.random.RandomState(0).rand(n) * 1e-6
    order = np.argsort(h); lab = np.empty(n, int); nbas = 0
    for v in order:
        lo = -1; hl = h[v]
        for j in nb[v]:
            if h[j] < hl: hl = h[j]; lo = j
        if lo < 0: lab[v] = nbas; nbas += 1
        else: lab[v] = lab[lo]
    vol = np.bincount(lab[filled0], minlength=nbas).astype(float)
    parent = list(range(nbas))
    def find(a):
        while parent[a] != a: parent[a] = parent[parent[a]]; a = parent[a]
        return a
    lake = np.full(n, -1); front = {}; inq = {}; cap = np.zeros(nbas); level = np.full(nbas, -np.inf); mins = {}
    for v in order[::-1]: mins[lab[v]] = v
    def start(b): v = mins[b]; front[b] = [(h[v], v)]; inq[b] = {v}
    todo = [b for b in range(nbas) if vol[b] > 0]
    for b in todo: start(b)
    while todo:
        b = find(todo.pop())
        if vol[b] <= cap[b] + 1e-9: continue
        Fq = front[b]
        while cap[b] < vol[b] - 1e-9 and Fq:
            hv, v = heapq.heappop(Fq)
            if lake[v] >= 0 and find(lake[v]) != b:
                o = find(lake[v]); parent[o] = b; vol[b] += vol[o]; cap[b] += cap[o]; level[b] = max(level[b], level[o])
                for x in front[o]: heapq.heappush(Fq, x)
                inq[b] |= inq[o]; continue
            if lake[v] >= 0: continue
            if hv < level[b] - 1e-9 and find(lab[v]) != b:
                o = find(lab[v]); extra = vol[b] - cap[b]; vol[b] = cap[b]; vol[o] += extra
                heapq.heappush(Fq, (hv, v))
                if o not in front: start(o)
                todo.append(o); break
            lake[v] = b; cap[b] += 1; level[b] = max(level[b], hv)
            for j in nb[v]:
                if j not in inq[b] and lake[j] != b: inq[b].add(j); heapq.heappush(Fq, (h[j], j))
    return lake >= 0
