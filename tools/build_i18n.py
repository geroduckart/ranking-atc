"""Mete el diccionario (tools/en.json) en netlify/lib/i18n.mjs y copia el motor dentro de public/index.html."""
import json, re, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
d = json.load(open(os.path.join(root, 'tools/en.json'), encoding='utf-8'))
p = os.path.join(root, 'netlify/lib/i18n.mjs'); s = open(p, encoding='utf-8').read()
body = ',\n'.join(f'  {json.dumps(k, ensure_ascii=False)}: {json.dumps(v, ensure_ascii=False)}' for k, v in d.items())
s = re.sub(r'const EN = \{.*?\n?\};\nconst I18N_NUM', lambda m: 'const EN = {/*DICT*/\n' + body + '\n};\nconst I18N_NUM', s, count=1, flags=re.S)
open(p, 'w', encoding='utf-8').write(s)
eng = s[s.index('/*I18N-START*/'):s.index('/*I18N-END*/') + len('/*I18N-END*/')]
h = os.path.join(root, 'public/index.html'); t = open(h, encoding='utf-8').read()
a, b = t.index('/*I18N-START*/'), t.index('/*I18N-END*/') + len('/*I18N-END*/')
open(h, 'w', encoding='utf-8').write(t[:a] + eng + t[b:])
print('dict', len(d))
