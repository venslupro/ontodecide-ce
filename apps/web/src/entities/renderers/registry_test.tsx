/**
 * @fileoverview Renderer registry: every DataType resolves to a renderer
 * with cell, text, input and filter operators; open for extension.
 */

import {SCALAR_TYPES} from '@ontodecide/ontology/contract';
import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {useForm, Controller} from 'react-hook-form';
import {describe, expect, it} from 'vitest';
import {renderWithProviders} from '../../test/render';
import {
  getRenderer,
  parseGeopoint,
  refTarget,
  registerRenderer,
  rendererKey,
  renderers,
  type RenderProp,
} from './registry';

const p = (dataType: string, extra: Partial<RenderProp> = {}): RenderProp => ({
  apiName: 'x',
  displayName: 'X',
  dataType,
  ...extra,
});

describe('renderer registry', () => {
  it('has a renderer for every scalar type and objectRef', () => {
    for (const t of SCALAR_TYPES) {
      const r = renderers.get(t);
      expect(r, t).toBeDefined();
      expect(r!.filterOps.length, t).toBeGreaterThan(0);
      expect(typeof r!.cell).toBe('function');
      expect(typeof r!.input).toBe('function');
    }
    expect(renderers.get('objectRef')).toBeDefined();
  });

  it('maps objectRef:<Type> to the objectRef renderer', () => {
    expect(rendererKey('objectRef:Supplier')).toBe('objectRef');
    expect(refTarget('objectRef:Supplier')).toBe('Supplier');
    expect(refTarget('string')).toBeUndefined();
    expect(getRenderer('objectRef:Material')).toBe(renderers.get('objectRef'));
  });

  it('falls back to string for unknown types', () => {
    expect(getRenderer('mystery')).toBe(renderers.get('string'));
  });

  it('offers operators appropriate to each type', () => {
    expect(getRenderer('double').filterOps).toEqual(
      expect.arrayContaining(['gt', 'gte', 'lt', 'lte']),
    );
    expect(getRenderer('integer').filterOps).not.toContain('contains');
    expect(getRenderer('string').filterOps).toEqual(
      expect.arrayContaining(['contains', 'in']),
    );
    expect(getRenderer('enum').filterOps).toEqual(
      expect.arrayContaining(['eq', 'in']),
    );
    expect(getRenderer('boolean').filterOps).toEqual(['eq', 'exists']);
    expect(getRenderer('geopoint').filterOps).toEqual(['exists']);
    expect(getRenderer('date').filterOps).toContain('gte');
    expect(getRenderer('timestamp').filterOps).toContain('lt');
    expect(getRenderer('objectRef:Supplier').filterOps).toEqual([
      'eq',
      'exists',
    ]);
  });

  it('parses filter values per type', () => {
    expect(getRenderer('integer').parse('7.9', p('integer'))).toBe(7);
    expect(getRenderer('double').parse('7.5', p('double'))).toBe(7.5);
    expect(getRenderer('double').parse('abc', p('double'))).toBeNull();
    expect(getRenderer('boolean').parse('true', p('boolean'))).toBe(true);
    expect(
      getRenderer('enum').parse(
        'watch',
        p('enum', {enumValues: ['active', 'watch']}),
      ),
    ).toBe('watch');
    expect(
      getRenderer('enum').parse(
        'nope',
        p('enum', {enumValues: ['active', 'watch']}),
      ),
    ).toBeNull();
    expect(getRenderer('date').parse('2026-09-24', p('date'))).toBe(
      '2026-09-24',
    );
    expect(
      getRenderer('timestamp').parse('2026-09-24T08:00:00Z', p('timestamp')),
    ).toBe('2026-09-24T08:00:00.000Z');
    expect(getRenderer('string').parse('', p('string'))).toBeNull();
  });

  it('formats plain text values', () => {
    expect(
      getRenderer('double').text(1234.5, p('double', {unit: 'units'})),
    ).toBe('1,234.5 units');
    expect(getRenderer('integer').text(null, p('integer'))).toBe('—');
    expect(getRenderer('boolean').text(false, p('boolean'))).toBe('false');
    expect(
      getRenderer('geopoint').text({lat: 31.23, lon: 121.47}, p('geopoint')),
    ).toBe('31.2300, 121.4700');
    expect(parseGeopoint('31.2, 121.4')).toEqual({lat: 31.2, lon: 121.4});
    expect(parseGeopoint([1, 2])).toEqual({lat: 1, lon: 2});
    expect(parseGeopoint('bad')).toBeNull();
  });

  it('renders cells with icon + text for booleans and badges for enums', () => {
    render(
      <div>
        <span data-testid="b">
          {getRenderer('boolean').cell(true, p('boolean'))}
        </span>
        <span data-testid="e">
          {getRenderer('enum').cell('watch', p('enum'))}
        </span>
        <span data-testid="n">
          {getRenderer('double').cell(78, p('double', {unit: 'pts'}))}
        </span>
        <span data-testid="empty">
          {getRenderer('string').cell(null, p('string'))}
        </span>
      </div>,
    );
    expect(screen.getByTestId('b')).toHaveTextContent('是');
    expect(screen.getByTestId('b').querySelector('svg')).not.toBeNull();
    expect(screen.getByTestId('e')).toHaveTextContent('watch');
    expect(screen.getByTestId('n')).toHaveTextContent('78pts');
    expect(screen.getByTestId('empty')).toHaveTextContent('—');
  });

  it('renders objectRef cells as Object View links', async () => {
    renderWithProviders(
      <div>
        {getRenderer('objectRef:Supplier').cell(
          'ri.t1.Supplier.S002',
          p('objectRef:Supplier'),
        )}
      </div>,
    );
    const link = await screen.findByRole('link');
    expect(link).toHaveAttribute('href', '/objects/rid/ri.t1.Supplier.S002');
  });

  it('binds inputs to react-hook-form with typed values', async () => {
    let values: Record<string, unknown> = {};
    function Form() {
      const f = useForm<Record<string, unknown>>({
        defaultValues: {n: 7, s: '', e: 'active'},
      });
      values = f.watch();
      return (
        <form>
          <Controller
            name="n"
            control={f.control}
            render={({field}) => (
              <>
                {getRenderer('integer').input(
                  p('integer', {displayName: 'N'}),
                  field,
                  {id: 'n'},
                )}
              </>
            )}
          />
          <Controller
            name="s"
            control={f.control}
            render={({field}) => (
              <>{getRenderer('string').input(p('string'), field, {id: 's'})}</>
            )}
          />
          <Controller
            name="e"
            control={f.control}
            render={({field}) => (
              <>
                {getRenderer('enum').input(
                  p('enum', {
                    displayName: 'E',
                    enumValues: ['active', 'watch'],
                    required: true,
                  }),
                  field,
                )}
              </>
            )}
          />
        </form>
      );
    }
    render(<Form />);
    const user = userEvent.setup();
    const num = document.getElementById('n') as HTMLInputElement;
    await user.clear(num);
    await user.type(num, '12');
    await user.type(document.getElementById('s') as HTMLInputElement, 'hello');
    await user.selectOptions(
      screen.getByRole('combobox', {name: 'E'}),
      'watch',
    );
    expect(values).toEqual({n: 12, s: 'hello', e: 'watch'});
  });

  it('is open for extension', () => {
    const custom = {...renderers.get('string')!, filterOps: ['eq' as const]};
    const prev = renderers.get('geopoint')!;
    registerRenderer('geopoint', custom);
    expect(getRenderer('geopoint').filterOps).toEqual(['eq']);
    registerRenderer('geopoint', prev);
  });
});
