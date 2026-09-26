import {describe, expect, it} from 'vitest';
import {AppError} from './errors';
import {assertLogic, evalLogic, logicVars} from './json_logic';

describe('evalLogic', () => {
  const data = {target: {riskScore: 72, status: 'active'}, params: {days: 7}};

  it('evaluates var, comparison and logic', () => {
    expect(evalLogic({'>=': [{var: 'target.riskScore'}, 70]}, data)).toBe(true);
    expect(
      evalLogic(
        {
          and: [
            {'>': [{var: 'params.days'}, 0]},
            {'<=': [{var: 'params.days'}, 30]},
          ],
        },
        data,
      ),
    ).toBe(true);
    expect(evalLogic({or: [false, 0, 'x']}, data)).toBe('x');
    expect(evalLogic({'!': [{var: 'missing'}]}, data)).toBe(true);
  });

  it('evaluates arithmetic and if chains', () => {
    expect(evalLogic({'+': [{var: 'params.days'}, 3]}, data)).toBe(10);
    expect(evalLogic({'-': [10, 4]}, data)).toBe(6);
    expect(evalLogic({'/': [1, 0]}, data)).toBeNull();
    const level = {
      if: [
        {'>=': [{var: 'riskScore'}, 70]},
        'HIGH',
        {'>=': [{var: 'riskScore'}, 40]},
        'MEDIUM',
        'LOW',
      ],
    };
    expect(evalLogic(level, {riskScore: 80})).toBe('HIGH');
    expect(evalLogic(level, {riskScore: 50})).toBe('MEDIUM');
    expect(evalLogic(level, {riskScore: 1})).toBe('LOW');
  });

  it('supports var defaults, in and between', () => {
    expect(evalLogic({var: ['nope', 5]}, {})).toBe(5);
    expect(evalLogic({in: ['a', ['a', 'b']]}, {})).toBe(true);
    expect(evalLogic({'<': [1, 2, 3]}, {})).toBe(true);
  });

  it('rejects unknown operators and runaway expressions', () => {
    expect(() => evalLogic({eval: ['x']}, {})).toThrow(AppError);
    const deep = Array.from({length: 1200}, () => 1);
    expect(() => evalLogic({'+': deep}, {})).toThrow(/step limit/);
  });

  it('lists referenced vars and validates operators', () => {
    expect(
      logicVars({
        and: [{var: 'target.status'}, {'>': [{var: 'params.days'}, 0]}],
      }),
    ).toEqual(['target', 'params']);
    expect(() => assertLogic({map: [1]})).toThrow(AppError);
    expect(() => assertLogic({'+': [1, {var: 'a'}]})).not.toThrow();
  });
});
