# 低质量代码样本：故意写坏，仅用于审计规则命中测试。
# 预期命中：python/variable-min-length（单字母变量）、python/magic-number（86400/3600）。


def calc(a, b):
    return a * 86400 + b * 3600
