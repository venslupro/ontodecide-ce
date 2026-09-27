/**
 * @fileoverview Import wizard steps (前端详细设计 数据导入, 修订 V2.4 #7:
 * step 4 is 「校验」, the V2.3 「质量规则」 step is gone).
 */

/** Wizard step keys in order (labels: `imports:wizard.steps.<key>`). */
export const WIZARD_STEPS = [
  'source',
  'upload',
  'mapping',
  'validate',
  'run',
] as const;

/** A wizard step key. */
export type WizardStep = (typeof WIZARD_STEPS)[number];
