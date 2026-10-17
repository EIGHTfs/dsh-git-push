// 低质量代码样本：故意写坏，仅用于审计规则命中测试（不要当真实代码引用）。
// 预期命中：readability/magic-number-smart、readability/variable-min-length、
//   readability/max-nesting-depth、security 硬编码密码类。
const a = 86400;

function deep(x) {
  if (x) {
    for (;;) {
      if (x) {
        if (x) {
          return 1;
        }
      }
    }
  }
}

const dbPassword = 'MyS3cretP@ss!';
