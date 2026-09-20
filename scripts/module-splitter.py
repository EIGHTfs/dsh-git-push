#!/usr/bin/env python3
"""module-splitter —— 把巨型单文件按职责切成多模块 + 纯引用 index（零依赖，只用 python3 标准库）。

用途：一个 .js 文件涨到几百上千行（路由/实现/调度/工具全塞在一起）时，
  按「顶层块」机械切到 <outdir>/ 的各模块，并生成只做再导出的 index.js，
  使调用方导入路径不变、对外导出面不变。

三个子命令：
    python3 module-splitter.py analyze <file.js>
        只读分析：列出顶层块（行号/行数）、块间依赖图、模块循环依赖风险、顶部 import。
        先跑这个，再据此写 plan.json —— 不要凭空猜哪块依赖哪块。

    python3 module-splitter.py split <plan.json> [--dry-run]
        按 plan 执行切分。--dry-run 只报告将要写入什么，不落盘。

    python3 module-splitter.py verify <plan.json>
        静态校验：index 再导出的名字集合是否与原文件「本来就 export」的名字集合完全一致
        （拆完必跑；少一个名字就是调用方会 undefined 的隐性破坏）。

plan.json 结构（示例见本文件末尾「PLAN 示例」）：
    {
      "file":    "lib/git/index.js",        # 待拆文件
      "outdir":  "lib/git",                 # 输出目录
      "index":   "index.js",                # 出口文件名
      "index_header": "/** 统一出口 ... */", # 出口文件头注释
      "plan":    { "exec.js": ["runGit", "gitRaw"], ... },  # 模块 → 顶层块名清单
      "headers": { "exec.js": "/** ... */", ... },          # 各模块头注释
      "external":{ "exec.js": ["import x from './y.js';"], ... }  # 需额外注入的 import
    }

设计要点（都是实战踩出来的，勿随意简化）：
  1. 块的起始行**向上吞掉紧邻的注释/空行**——否则文档注释留在旧文件里丢失。
  2. 原有 import 按**符号**分发：解析原文件每条 import 的符号，哪个模块用到就带上。
     不靠猜 builtin 清单（曾因靠猜导致 makeCodeLineFilter / CODE_EXTS 漏 import）。
  3. 符号引用检测前**先剥注释**：文档注释里常提到别的函数名，会造成假依赖甚至假循环
     （实测 gitRaw 注释提到 pushViaApi → 误报 exec.js ↔ transport.js 循环）。
  4. 跨模块引用的**内部**符号自动补 export，但**不进 index 再导出**——
     保证对外公开面与拆分前完全一致。
  5. index 只再导出「原文件本来就 export 的符号」，顺序保持原样。
  6. 模块间引用做**环检测**，发现环直接报错（ESM 循环会让符号静默变 undefined，极难查）。
  7. 全部块必须被分配，漏一个就报错——防止「拆完发现少了个函数」这种静默丢失。

PLAN 示例：
    {
      "file": "lib/git/index.js",
      "outdir": "lib/git",
      "index": "index.js",
      "index_header": "/**\\n * Git 操作层 · 统一出口（只做再导出）\\n */",
      "plan": {
        "exec.js":        ["runGit", "gitRaw"],
        "credentials.js": ["credentialsDir", "resolveToken"],
        "push.js":        ["commitAndPush"]
      },
      "headers": {
        "exec.js": "/**\\n * Git 执行层 · 进程调用\\n */"
      }
    }
"""
import json
import os
import re
import subprocess
import sys
from pathlib import Path


# ───────────────────────── 解析 ─────────────────────────

def strip_comments(code: str) -> str:
    """去掉 // 行注释与 /* */ 块注释，仅供「符号引用检测」使用。

    为什么必须剥：文档注释里常在散文里提到别的函数名（实测 gitRaw 的注释提到
    pushViaApi → 被误判为 exec.js 依赖 transport.js，进而报出并不存在的模块循环）。
    检测用剥注释文本，产出仍用原文。
    """
    out = []
    i, n = 0, len(code)
    while i < n:
        two = code[i:i + 2]
        if two == '//':
            j = code.find('\n', i)
            i = n if j < 0 else j
            continue
        if two == '/*':
            j = code.find('*/', i + 2)
            i = n if j < 0 else j + 2
            continue
        out.append(code[i])
        i += 1
    return ''.join(out)


PUNCT_ALLOWS_REGEX = ('', '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}',
                       ';', '+', '-', '*', '%', '<', '>', '~', '^')
# 这些关键字后面出现的 `/` 一定是正则字面量（它们都期待一个表达式）
REGEX_KEYWORDS = frozenset((
    'return', 'typeof', 'case', 'in', 'of', 'new', 'delete', 'void',
    'instanceof', 'do', 'else', 'yield', 'await', 'throw',
))


def regex_allowed(prev_sig: str, prev_word: str) -> bool:
    """判断当前位置的 `/` 是否为正则字面量起始（而非除号）。

    为什么需要：正则常含**不成对**的括号/方括号（如 `/[/\-._A-Za-z0-9]/` 里的 `[`、`]`）。
    若不识别正则字面量，深度计数会被算乱，后续所有顶层语句边界全错——实测
    lib/audit/index.js 的 isVersionInPathContext 因此把后面 5 个 export function
    全吞掉（auditFile/auditFull/auditChanged/auditWithScope 一个都识别不出来）。

    判定必须**看词法单元而非单个字符**：`return /re/` 与 `a / b` 里 `/` 的前一个字符
    都是字母，只按字符判断会把 `return` 后面的正则误判成除号——误判后 `[` 加深度、
    紧随的 `/` 又被当成正则起始，把配对的 `]` 一起吞掉，深度从此永久残留。
    故：前一字符是标点（不能作为表达式结尾）→ 正则；或前一个词是
    return/typeof/case 等期待表达式的关键字 → 正则。
    """
    if prev_sig in PUNCT_ALLOWS_REGEX:
        return True
    return prev_word in REGEX_KEYWORDS


def parse_export_clauses(src: str):
    """收集顶层 `export { ... };` / `export { ... } from '...';` 子句。

    为什么必须收集：公开面不止「function/const 声明」——文件末尾常有一句
    `export { helperA, helperB };` 把别处 import 进来的符号再导出。只按声明统计导出
    会漏掉它们，切分后出口少这一句 → **公开面静默缩小**（实测 lib/index.js 的
    `export { routeRequest, readJsonBody };` 就是这种）。
    返回 [{names: [...], from: 路径或 None, raw: 原语句}]。
    """
    out = []
    for m in re.finditer(r"^export\s*\{([^}]*)\}\s*(?:from\s*(['\"])([^'\"]+)\2\s*)?;", src, re.M):
        names = [x.strip() for x in m.group(1).split(',') if x.strip()]
        out.append({'names': names, 'from': m.group(3), 'raw': m.group(0)})
    return out


def prune_import_for(syms, imports):
    """生成「只含指定符号」的 import 语句（按原语句分组后裁剪）。"""
    need = []
    seen = set()
    for sym in syms:
        stmt = imports.get(sym)
        if stmt and stmt not in seen:
            seen.add(stmt)
            others = [x for x, st in imports.items() if st == stmt]
            if all(x in syms for x in others):
                need.append(stmt)
            else:
                need.append(re.sub(r'\{.*\}', '{ ' + ', '.join(x for x in others if x in syms) + ' }', stmt))
    return need


def rewrite_rel_imports(stmt: str, orig_dir: str, mod_dir: str) -> str:
    """把 import 里的相对路径按「模块新位置」重算（含裸副作用 import）。

    为什么必须做：切分常把模块放进**子目录**（lib/rule/compilers.js →
    lib/rule/compilers/regex.js）。原文件里的 `./registry.js` 指的是 lib/rule/registry.js，
    照抄进子目录模块会解析成 lib/rule/compilers/registry.js → ERR_MODULE_NOT_FOUND。
    做法：把原相对路径按「原文件所在目录」解析，再相对「新模块所在目录」重算。
    绝对路径与裸包名（node:*、@scope/pkg）原样保留。
    """
    m = re.match(r"^import\s+.+?\s+from\s+(['\"])(\.[^'\"]*)\1;", stmt) \
        or re.match(r"^import\s+(['\"])(\.[^'\"]*)\1;", stmt)
    if not m:
        return stmt
    src = m.group(2)
    target = os.path.normpath(os.path.join(orig_dir, src))
    rel = os.path.relpath(target, mod_dir)
    if not rel.startswith('.'):
        rel = './' + rel
    return stmt[:m.start(2)] + rel + stmt[m.end(2):]


def parse_side_effect_imports(src: str):
    """收集**裸副作用 import**：`import './x.js';`（无绑定符号）。

    为什么必须单独收集：parse_imports 按「符号 → 语句」建表，裸 import 没有任何符号，
    不会被任何模块「用到」→ 整条在切分时被静默丢弃。而这类 import 恰恰常是关键的
    初始化开关——实测 lib/audit/index.js 的 `import '../rule/compilers.js';`
    就是「注册全部规则编译器」的唯一触发点，丢掉后审计拿到空编译器表，
    结果静默变化（不报错，只是检查项全不出）。
    做法：这类语句统一保留到出口文件（入口 import 即完成初始化），并同步重算相对路径。
    """
    return re.findall(r"^import\s+['\"][^'\"]+['\"];.*$", src, re.M)


def rewrite_dynamic_imports(text: str, orig_dir: str, mod_dir: str) -> str:
    """重写正文里的**动态** import 路径：`import('./x.js')` / `require('./x.js')`。

    为什么单独处理：上面的 rewrite_rel_imports 只认顶层 import 语句，而代码里常有
    函数体内的延迟 import（用来破循环依赖）。模块挪进子目录后这些路径同样失效——
    实测 listRegisteredKinds 的 `import('./registry.js')` 未重写，加载时直接
    ERR_MODULE_NOT_FOUND（找 lib/rule/compilers/registry.js）。
    """
    def fix(m):
        quote, src = m.group(1), m.group(2)
        target = os.path.normpath(os.path.join(orig_dir, src))
        rel = os.path.relpath(target, mod_dir)
        if not rel.startswith('.'):
            rel = './' + rel
        return f'import({quote}{rel}{quote})'

    return re.sub(r"import\(\s*(['\"])(\.[^'\"]*)\1\s*\)", fix, text)


def top_level_statements(src: str):
    """按**括号深度**切出顶层语句 → [(start, end)]（0-based，end 不含）。

    为什么不能用「下一个顶层声明」当块尾：那假定了文件里只有函数/常量声明。注册表类
    文件里大量顶层**语句**（registerCompiler('kind', ...)）不是声明，于是上一个声明的
    块尾会一路吞到下一个声明为止——实测 numericKinds（数组声明，真实到 139 行）的块尾
    被撑到 264 行，把后面 6 个 registerCompiler 语句全算成它的正文。

    正确做法：维护 () [] {} 深度 + 块注释/字符串/正则字面量状态，深度为 0 时遇到新的
    行首非空行即视为新语句开始。
    """
    lines = src.split('\n')
    starts = []
    depth = 0
    in_block_comment = False
    prev_sig = ''          # 上一个非空白字符（含字母）
    prev_word = ''         # 上一个完整的词法单元（标识符/关键字）
    cur_word = ''          # 正在累积的词法单元
    for i, line in enumerate(lines):
        if depth == 0 and not in_block_comment and line.strip() \
                and re.match(r'^\S', line) and not re.match(r'^[)\]}.,;]', line):
            starts.append(i)
        j, n = 0, len(line)
        while j < n:
            two = line[j:j + 2]
            if in_block_comment:
                if two == '*/':
                    in_block_comment = False
                    j += 2
                    continue
                j += 1
                continue
            if two == '/*':
                in_block_comment = True
                j += 2
                continue
            if two == '//':
                break
            ch = line[j]
            if ch in '\'"`':
                quote = ch
                j += 1
                while j < n:
                    if line[j] == '\\':
                        j += 2
                        continue
                    if line[j] == quote:
                        break
                    j += 1
                j += 1
                prev_word, cur_word = (cur_word or prev_word), ''
                prev_sig = quote
                continue
            if ch == '/' and regex_allowed(prev_sig, cur_word or prev_word):
                j += 1
                in_class = False
                while j < n:
                    c2 = line[j]
                    if c2 == '\\':
                        j += 2
                        continue
                    if c2 == '[':
                        in_class = True
                    elif c2 == ']':
                        in_class = False
                    elif c2 == '/' and not in_class:
                        break
                    j += 1
                j += 1
                prev_word, cur_word = (cur_word or prev_word), ''
                prev_sig = '/'
                continue
            if ch.isalnum() or ch in '_$':
                cur_word += ch
                prev_sig = ch
            else:
                if cur_word:
                    prev_word, cur_word = cur_word, ''
                if not ch.isspace():
                    prev_sig = ch
                if ch in '([{':
                    depth += 1
                elif ch in ')]}':
                    depth = max(0, depth - 1)
            j += 1
    out = []
    for k, st in enumerate(starts):
        en = starts[k + 1] if k + 1 < len(starts) else len(lines)
        while en > st and not lines[en - 1].strip():
            en -= 1
        out.append((st, en))
    return out


def parse_blocks(src: str):
    """解析顶层块 → [{name, exported, start, end, body}]，start 含其前置注释。

    只有「命名声明」算块；顶层匿名语句（registerCompiler 调用等）不是块，需按行范围分配。
    """
    lines = src.split('\n')
    out = []
    for st, en in top_level_statements(src):
        m = re.match(r'^(export )?(?:async )?(function|const|let) (\w+)', lines[st])
        if not m:
            continue
        start = st
        while start > 0 and re.match(r'^\s*(//|/\*|\*|\*/|$)', lines[start - 1]):
            start -= 1
        out.append({'name': m.group(3), 'exported': bool(m.group(1)), 'start': start, 'end': en,
                    'body': '\n'.join(lines[start:en]).strip('\n')})
    return out


def parse_imports(src: str):
    """{符号: 原样 import 语句}——用于按符号把原 import 分发到各模块。"""
    sym2stmt = {}
    for m in re.finditer(r'^import\s+(.+?)\s+from\s+[\'"]([^\'"]+)[\'"];', src, re.M):
        clause, stmt = m.group(1), m.group(0)
        inner = re.search(r'\{(.*)\}', clause)
        if inner:
            for sym in inner.group(1).split(','):
                sym = sym.strip()
                if sym:
                    sym2stmt[sym.split(' as ')[-1].strip()] = stmt
        else:
            sym2stmt[clause.split(',')[0].strip()] = stmt
    return sym2stmt


def collect_ownership(plan, blocks, ranges_of, lines):
    """符号 → 模块 的归属表，额外纳入「行范围内的顶层声明」。

    为什么需要：按行范围切的模块（注册表类文件的语句段）里也可能新增顶层声明，
    若只按命名块归属，别的模块引用到它就检测不出依赖 → 漏 import（运行期
    ReferenceError）。故把范围内声明的符号也登记进来。
    """
    owner = {}
    for mod, value in plan.items():
        names, ranges = split_entry(value)
        for n in names:
            owner[n] = mod
        for a, z in ranges:
            chunk = '\n'.join(lines[a - 1:z])
            for m in re.finditer(r'^(?:export\s+)?(?:async\s+)?(?:function|const|let)\s+(\w+)', chunk, re.M):
                owner.setdefault(m.group(1), mod)
    return owner


def audit_coverage(plan, blocks, ranges_of, lines, source_lines):
    """行级覆盖审计：任何一行原文都必须被**恰好一个**模块承载。

    为什么必须做行级（而不是只查「块是否分配」）：块级检查存在漏洞——块被按名字
    分配后，其正文又因行范围被截断，剩余部分就无人承载而**静默丢失**。
    实测 numericKinds（126-264）按名分配、又被范围 142-160 截断，
    导致 161-264 整段数组内容蒸发，而块级检查完全看不出来。

    返回 (未覆盖行号列表, 重复覆盖行号列表)；重复覆盖视为硬错误（同一段代码进了
    两个模块），未覆盖仅剔除空行/纯注释/import 后报告。
    """
    count = {}
    for mod, value in plan.items():
        names, ranges = split_entry(value)
        spans = [(blocks[n]['start'], blocks[n]['end']) for n in names]
        spans += [(a - 1, z) for a, z in ranges]
        for a, z in spans:
            for i in range(a, z):
                count[i] = count.get(i, 0) + 1
    dup = sorted(i + 1 for i, c in count.items() if c > 1)
    # 「被出口文件保留」的语句不算丢失：裸副作用 import 与 export 子句都会原样
    # 写进 index（见 parse_side_effect_imports / parse_export_clauses），
    # 故审计里视为已覆盖，否则会误报「未承载」而拦下正确的 plan。
    trivial = re.compile(r'^\s*(//|/\*|\*|\*/|import\s|export\s*\{|$)')
    missing = [i + 1 for i in range(len(source_lines))
               if i not in count and not trivial.match(source_lines[i])]
    return missing, dup


def module_parts(plan, blocks, ranges_of, lines):
    """{模块: [(块名或 None, 文本)]}——保留分段信息，便于逐块补 export。

    为什么不能只给拼接好的整段文本：跨模块内部符号需要补 `export` 前缀，而补注入是
    按块定位的（`^(async )?(function|const|let)`）。若作用于整段正文，模块开头的
    注释/import 会让锚点 `^` 匹配不到，补 export 就**静默失效**——实测 helpers.js 的
    ruleOut/severityLevel 因此没被 export，别的模块 import 时报
    「does not provide an export named 'ruleOut'」。
    """
    out = {}
    for mod, value in plan.items():
        # **必须按 plan 里的原顺序**逐项组装：命名块与行范围常需交错
        # （如先 `let Schema = null` → 再 try 赋值语句 → 再兜底函数 → 再 `if (!Schema)` 兜底调用），
        # 若「命名块全排前、行范围全追加到末尾」，语句会被搬到最后——
        # 实测 lib/app/schema.js 里 `Schema = makeFallbackSchema()` 被排到 Config 之后，
        # 于是 Config 求值时 Schema 仍是 null，直接 `Cannot read properties of null`。
        parts = []
        for item in value:
            if isinstance(item, str):
                parts.append((item, blocks[item]['body']))
            else:
                a, z = item
                parts.append((None, range_text(lines, a, z)))
        out[mod] = parts
    return out


def module_texts(plan, blocks, ranges_of, lines):
    """{模块: 该模块的正文文本}——命名块取块文本，行范围取区间文本，按 plan 顺序拼接。"""
    parts = module_parts(plan, blocks, ranges_of, lines)
    return {mod: '\n\n'.join(t for _n, t in ps) for mod, ps in parts.items()}


def dep_edges(blocks, owner, plan, texts):
    """{模块: {源模块: [符号]}}，按「剥注释后的真实引用」计算。"""
    edges = {}
    for mod in plan:
        body = strip_comments(texts[mod])
        refs = set()
        for other, omod in owner.items():
            if omod != mod and re.search(r'\b' + re.escape(other) + r'\b', body):
                refs.add(other)
        by_mod = {}
        for sym in sorted(refs):
            by_mod.setdefault(owner[sym], []).append(sym)
        edges[mod] = by_mod
    return edges


def detect_cycles(plan, edges):
    """返回循环路径（无环返回 None）。ESM 循环会让符号静默 undefined，必须拦。"""
    WHITE, GRAY = 0, 1
    color = {m: WHITE for m in plan}

    def dfs(u, stack):
        color[u] = GRAY
        for v in edges.get(u, {}):
            if color[v] == GRAY:
                return stack + [u, v]
            if color[v] == WHITE:
                found = dfs(v, stack + [u])
                if found:
                    return found
        color[u] = 2
        return None

    for m in plan:
        if color[m] == WHITE:
            found = dfs(m, [])
            if found:
                return found
    return None


def split_entry(value):
    """plan 的一个条目 → (块名清单, 行范围清单)。

    条目值可以是字符串（顶层块名）或 [起, 止]（1-based 闭区间行号）的混合列表。
    为什么需要行范围：并非所有文件都是「顶层命名块」结构——注册表类文件
    （一串 registerCompiler('kind', ...) 语句 + 共享助手）没有名字可指，
    只能按语句行范围切；只支持命名块的工具在这类文件上完全用不了。
    """
    names, ranges = [], []
    for item in value:
        if isinstance(item, str):
            names.append(item)
        elif isinstance(item, (list, tuple)) and len(item) == 2 and all(isinstance(x, int) for x in item):
            ranges.append((item[0], item[1]))
        else:
            sys.exit(f'❌ plan 条目格式不对（应为块名或 [起,止]）：{item!r}')
    return names, ranges


def absorb_up(lines, i):
    """从 0-based 行 i 向上吞掉紧邻的注释/空行，返回新的起始行。"""
    while i > 0 and re.match(r'^\s*(//|/\*|\*|\*/|$)', lines[i - 1]):
        i -= 1
    return i


def range_text(lines, start, end):
    """取 1-based 闭区间 [start, end] 的文本，并向上吞掉紧邻注释。"""
    if not (1 <= start <= end <= len(lines)):
        sys.exit(f'❌ 行范围越界：{start}-{end}（文件共 {len(lines)} 行）')
    a = absorb_up(lines, start - 1)
    return '\n'.join(lines[a:end]).strip('\n')


def reconcile_blocks_with_ranges(blocks, lines, ranges):
    """把「跨到行范围内的命名块」按范围起点截断，返回新的块字典。

    为什么需要：块尾边界 = 下一个「顶层声明」起点；当文件末尾是一串非声明的顶层
    语句（如 registerCompiler('kind', ...)）时，最后一个命名块的边界会一路延伸到
    EOF，把这些语句也吞进去——若这些语句同时又按行范围分配给了别的模块，同一段
    代码就会**同时出现在两个模块里**（实测 listRegisteredKinds 吞掉 16 个
    registerCompiler 语句，与 structure/frontend/file-health 的正文重复）。

    规则（行范围是显式意图，优先级高于自动推断的块边界）：
      · 范围起点落在块内部 → 块尾截断到该范围起点之前
      · 范围完全覆盖块起点 → 直接报错（该块应改为按范围分配，不该出现在 names 里）
    """
    out = {}
    for name, b in blocks.items():
        b = dict(b)
        for a, _z in ranges:
            a0 = a - 1                     # 1-based → 0-based
            if b['start'] < a0 < b['end']:
                # 必须**可见**：静默截断会产出语法坏文件（实测把块尾的闭合 `}` 划给了
                # 另一个模块的范围，写出 `function f() { …` 不带 `}`），而截断本身是
                # 合法设计（块尾延伸到后续匿名语句时正需截断），所以只能提示不能报错。
                print(f"  ⚠ 块 {name} 的尾部被行范围 {a}-{_z} 截断：{b['start'] + 1}-{b['end']}"
                      f" → {b['start'] + 1}-{a0}（若该范围起点其实是本块的闭合括号，说明 plan 写错了："
                      f"范围应从块的后一行开始）")
                b['end'] = a0
        for a, z in ranges:
            a0, z0 = a - 1, z - 1
            if a0 <= b['start'] <= z0:
                sys.exit(f'❌ 块 {name}（行 {b["start"] + 1}）落在行范围 {a}-{z} 内：'
                         f'该块应从 names 移除，直接由该范围承载。')
        body = '\n'.join(lines[b['start']:b['end']]).strip('\n')
        if not body:
            sys.exit(f'❌ 块 {name} 截断后为空（行范围与块边界冲突，请检查 plan）')
        b['body'] = body
        out[name] = b
    return out


def load_plan(path):
    cfg = json.loads(Path(path).read_text(encoding='utf-8'))
    target = Path(cfg['file'])
    src = target.read_text(encoding='utf-8')
    lines = src.split('\n')
    plan = cfg['plan']
    owner, ranges_of = {}, {}
    for mod, value in plan.items():
        names, ranges = split_entry(value)
        for n in names:
            owner[n] = mod
        ranges_of[mod] = ranges
    all_ranges = [r for rs in ranges_of.values() for r in rs]
    blocks = reconcile_blocks_with_ranges({b['name']: b for b in parse_blocks(src)}, lines, all_ranges)
    for n in owner:
        if n not in blocks:
            sys.exit(f'❌ plan 里的块不存在: {n}（{target}）')
    owner = collect_ownership(plan, blocks, ranges_of, lines)
    missing, dup = audit_coverage(plan, blocks, ranges_of, lines, lines)
    if dup:
        shown = dup[:12]
        sys.exit(f'❌ 以下行被多个模块重复承载（同一段代码进两个模块）：{shown}'
                 f'{" …共 " + str(len(dup)) + " 行" if len(dup) > 12 else ""}\n'
                 f'   常见原因：命名块与行范围重叠（一个块按名分配、其正文又被范围截断/覆盖）。')
    if missing:
        shown = missing[:12]
        sys.exit(f'❌ 以下原文行没有任何模块承载（拆完会静默丢失）：{shown}'
                 f'{" …共 " + str(len(missing)) + " 行" if len(missing) > 12 else ""}\n'
                 f'   常见原因：只把块按名分配、却没覆盖该块被截断后剩下的正文。')
    return cfg, target, src, blocks, plan, owner, ranges_of, lines


# ───────────────────────── 子命令 ─────────────────────────

def cmd_analyze(argv):
    path = Path(argv[0])
    src = path.read_text(encoding='utf-8')
    blocks = parse_blocks(src)
    total = src.count('\n') + 1
    print(f'═══ {path} ═══')
    print(f'总行数 {total}｜顶层块 {len(blocks)}｜公开导出 {sum(1 for b in blocks if b["exported"])}\n')
    print('顶层块（行号 / 行数 / 是否导出）：')
    for b in blocks:
        n = b['body'].count('\n') + 1
        flag = 'export' if b['exported'] else '      '
        print(f'  {b["start"] + 1:>5}  {n:>4} 行  {flag}  {b["name"]}')
    print('\n块间依赖（供划分模块用；已剥注释，不含散文提及）：')
    by_name = {b['name']: b['body'] for b in blocks}
    for b in blocks:
        refs = sorted(n for n in by_name
                      if n != b['name'] and re.search(r'\b' + re.escape(n) + r'\b', strip_comments(b['body'])))
        if refs:
            print(f'  {b["name"]:<34} → {", ".join(refs)}')
    imps = [l for l in src.split('\n') if l.startswith('import ')]
    if imps:
        print('\n顶部 import（按符号自动分发到各模块）：')
        for i in imps:
            print('  ', i)
    print('\n下一步：据上表把块分到 plan.json 的 plan 里，再跑 split。')


def cmd_split(argv):
    dry = '--dry-run' in argv
    argv = [a for a in argv if a != '--dry-run']
    cfg, target, src, blocks, plan, owner, ranges_of, lines = load_plan(argv[0])
    outdir = Path(cfg['outdir'])
    imports = parse_imports(src)
    parts_by_mod = module_parts(plan, blocks, ranges_of, lines)
    texts = {m: '\n\n'.join(t for _n, t in ps) for m, ps in parts_by_mod.items()}
    edges = dep_edges(blocks, owner, plan, texts)
    # 「被别的模块引用、需要补 export」的符号集合。
    # 注意不能写成 `name in refs`——edges 是 {模块: {源模块: [符号]}} 的**三层**结构，
    # 那样等于拿符号名去查模块名，永远为假 → 内部符号静默不 export → 别的模块 import
    # 时报「does not provide an export named 'ruleOut'」。必须展平到符号层再判断。
    cross_needed = {sym for by_mod in edges.values() for syms in by_mod.values() for sym in syms}
    cyc = detect_cycles(plan, edges)
    if cyc:
        sys.exit(f'❌ 模块循环依赖：{" → ".join(cyc)}\n'
                 f'   ESM 循环会让符号静默变 undefined，请调整 plan 让依赖成 DAG。')

    orig_dir = str(target.parent)
    print(f'✓ 依赖图无环，开始{"预演" if dry else "切分"}：{target} → {outdir}/')
    written = {}
    for mod in plan:
        # 内部符号若被跨模块引用 → 逐块补 export（行范围内的语句本身不需 export）
        pieces = []
        for name, text in parts_by_mod[mod]:
            if name and not blocks[name]['exported'] and name in cross_needed:
                # 用多行锚点：块文本以「前置注释」开头（块起始行向上吞了注释），
                # 单行模式 `^` 只会匹配到注释首行，永远补不上 export。
                # 加了 re.M 后锚点落在第一条真正的声明行上（注释行以 // 或 * 开头，不会误匹配）。
                text = re.sub(r'(?m)^((?:async )?(?:function|const|let) )', r'export \1', text, count=1)
            pieces.append(text)
        body = '\n\n'.join(pieces)
        body_all = strip_comments(body)
        used = {sym for sym in imports if re.search(r'\b' + re.escape(sym) + r'\b', body_all)}
        mod_dir = str(outdir)
        final, seen = [], set()
        for sym, stmt in imports.items():
            if sym in used and stmt not in seen:
                seen.add(stmt)
                syms = [s for s, st in imports.items() if st == stmt]
                if all(s in used for s in syms):
                    picked = stmt
                else:
                    kept = [s for s in syms if s in used]
                    picked = re.sub(r'\{.*\}', '{ ' + ', '.join(kept) + ' }', stmt)
                final.append(rewrite_rel_imports(picked, orig_dir, mod_dir))
        for m2, syms in sorted(edges[mod].items()):
            final.append(f"import {{ {', '.join(syms)} }} from './{m2}';")
        final += cfg.get('external', {}).get(mod, [])
        body = rewrite_dynamic_imports(body, orig_dir, str(outdir))
        content = '\n\n'.join(x for x in [cfg.get('headers', {}).get(mod, ''),
                                          '\n'.join(final), body] if x)
        content = re.sub(r'\n{3,}', '\n\n', content).strip('\n') + '\n'
        written[mod] = content
        if not dry:
            outdir.mkdir(parents=True, exist_ok=True)
            (outdir / mod).write_text(content, encoding='utf-8')
    # 写盘后语法校验：这是唯一能抓住「块边界被划错导致少了个闭合括号」这类
    # 静默产坏文件的手段——上面所有行级覆盖审计都只看「行有没有被承载」，
    # 看不出承载之后拼出来的文本是否仍是合法程序（实测漏过：块尾 `}` 被划给别的模块，
    # 审计全过、写出的文件 node 直接 SyntaxError）。
    if not dry and not cfg.get('skip_syntax_check'):
        for mod, content in written.items():
            if not mod.endswith(('.js', '.mjs', '.cjs')):
                continue
            probe = subprocess.run(['node', '--check', '--input-type=module'],
                                   input=content, capture_output=True, text=True)
            if probe.returncode != 0:
                err = (probe.stderr or '').strip().splitlines()
                detail = next((l for l in err if 'Error' in l), err[0] if err else '')
                sys.exit(f'❌ {mod} 语法校验失败——模块文本已写出但**不是合法 JS**，'
                         f'通常是块边界/行范围把闭合括号划走了：{detail}\n'
                         f'   该文件已留在 {outdir}/{mod}，修好 plan 后重跑。')

    orig_exports = [b['name'] for b in parse_blocks(src) if b['exported']]
    clauses = parse_export_clauses(src)
    by_mod = {}
    for n in orig_exports:
        by_mod.setdefault(owner[n], []).append(n)
    idx_lines = [cfg.get('index_header', f'/**\n * {target.name} · 统一出口（只做再导出，不含实现）\n */'), '']
    # 裸副作用 import 原样保留到出口（路径按新位置重算）——它们是初始化开关，丢了会静默改变行为
    bare = [rewrite_rel_imports(st, orig_dir, str(outdir)) for st in parse_side_effect_imports(src)]
    for st in bare:
        idx_lines.append(st)
    if bare:
        idx_lines.append('')
    # 副作用导入：注册表类文件靠 import 触发注册（顺序 = plan 顺序，保持原注册次序）
    for m in cfg.get('index_imports', []):
        idx_lines.append(f"import './{m}';")
    if cfg.get('index_imports'):
        idx_lines.append('')
    for mod in plan:
        if mod in by_mod:
            idx_lines.append(f"export {{ {', '.join(by_mod[mod])} }} from './{mod}';")
        elif mod not in set(cfg.get('index_imports', [])):
            # （已由 index_imports 显式声明的跳过，避免重复 import 行）
            # 没有任何导出的模块 = 只有顶层语句（注册表类文件：一串 registerCompiler(...)）。
            # 它不会出现在任何再导出行里，若不显式 import，**整个模块永远不会被加载**，
            # 里面的注册/初始化全部不执行——不报错、不崩，只是「功能静默消失」
            # （实测：registry.js 的三条 registerCompiler 一条都没跑）。
            # 与裸副作用 import 是同一类失效，故同样必须保证被 import。
            idx_lines.append(f"import './{mod}';")
    # 原有的 export 子句必须原样保留（公开面的一部分）
    for cl in clauses:
        if cl['from']:
            idx_lines.append(rewrite_rel_imports(cl['raw'], orig_dir, str(outdir)))
        else:
            # 无 from：再导出的是本文件 import 进来的符号，出口必须先把它们 import 进来，
            # 否则 `export { x };` 会因绑定不存在直接 SyntaxError。
            for stmt in prune_import_for(cl['names'], imports):
                idx_lines.append(rewrite_rel_imports(stmt, orig_dir, str(outdir)))
            idx_lines.append(cl['raw'])
    index_name = cfg.get('index', 'index.js')
    written[index_name] = '\n'.join(idx_lines) + '\n'
    if not dry:
        (outdir / index_name).write_text(written[index_name], encoding='utf-8')

    for m, c in sorted(written.items(), key=lambda x: -x[1].count('\n')):
        print(f'   {m:<24} {c.count(chr(10)) + 1:>5} 行')
    print(f'\n   原文件 {src.count(chr(10)) + 1} 行 → {len(plan)} 模块 + {index_name}')
    print(f'   原导出 {len(orig_exports)} 个（index 全部保留，顺序不变）')
    if dry:
        print('\n（--dry-run：未写盘）')
    else:
        print('\n下一步（必做，缺一不可）：')
        print('   1. node --check 每个新模块')
        print('   2. python3 module-splitter.py verify <plan.json>   # 导出名集合比对')
        print('   3. 跑全部测试')
        print('   4. 与拆分前做审计/输出产出比对（未受影响文件的结果应逐条一致）')
        print('   5. 确认旧文件已删除、无残留重复实现')


def cmd_verify(argv):
    cfg, target, src, blocks, plan, owner, ranges_of, lines = load_plan(argv[0])
    outdir = Path(cfg['outdir'])
    index_name = cfg.get('index', 'index.js')
    idx = (outdir / index_name)
    if not idx.exists():
        sys.exit(f'❌ 出口文件不存在: {idx}（先跑 split）')
    idx_src = idx.read_text(encoding='utf-8')
    reexported = set()
    # 两种形态都要认：`export { a } from './m.js';`（模块再导出）与
    #   `export { a, b };`（把出口自己 import 进来的符号再导出，原文件末尾常见）。
    #   只匹配带 from 的那种会把后者判成「丢失导出」，误报 verify 失败。
    for m in re.finditer(r"^export\s*\{([^}]*)\}\s*(?:from\s*['\"][^'\"]*['\"]\s*)?;", idx_src, re.M):
        reexported |= {s.strip() for s in m.group(1).split(',') if s.strip()}
    reexported |= set(re.findall(r'^export\s+(?:async )?(?:function|const|let)\s+(\w+)', idx_src, re.M))
    original = {b['name'] for b in parse_blocks(src) if b['exported']}
    for cl in parse_export_clauses(src):
        original |= set(cl['names'])
    missing = sorted(original - reexported)
    extra = sorted(reexported - original)
    print(f'原文件导出 {len(original)} 个｜{index_name} 再导出 {len(reexported)} 个')
    if missing:
        print(f'❌ 丢失导出（调用方会拿到 undefined）: {missing}')
    if extra:
        print(f'⚠ 新增导出（扩大了公开面，确认是否有意）: {extra}')
    if not missing and not extra:
        print('✅ 导出面与拆分前完全一致')
    # 附带：检查残留文件
    print(f'\n原文件 {target} ' + ('仍存在——确认是否要删除（保留会形成两份实现）'
                                  if target.exists() else '已删除（正确）'))
    sys.exit(1 if missing else 0)


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in ('analyze', 'split', 'verify'):
        print(__doc__)
        sys.exit(0 if len(sys.argv) == 1 or sys.argv[1] in ('-h', '--help') else 1)
    {'analyze': cmd_analyze, 'split': cmd_split, 'verify': cmd_verify}[sys.argv[1]](sys.argv[2:])


if __name__ == '__main__':
    main()
