/**
 * @fileoverview Scenario list: stored scenarios with perturbation summary and
 * risk level; "new scenario" entry.
 */

import {screen, within} from '@testing-library/react';
import {describe, expect, it} from 'vitest';
import * as fx from '../../test/fixtures';
import {renderApp} from '../../test/render';

describe('ScenarioListPage', () => {
  it('lists scenarios with perturbations and risk level', async () => {
    renderApp('/scenarios', {user: fx.operatorUser});
    const link = await screen.findByRole(
      'link',
      {name: 'Hanoi capacity −60%'},
      {timeout: 5000},
    );
    const row = link.closest('tr')!;
    expect(within(row).getByText('-60%')).toBeInTheDocument();
    expect(await within(row).findByText('产能')).toBeInTheDocument();
    expect(within(row).getByText('高')).toBeInTheDocument();
    expect(screen.getByRole('link', {name: '新建推演'})).toHaveAttribute(
      'href',
      '/scenarios/new',
    );
  });
});
