/**
 * @fileoverview EvidenceChain: every item deep-links to the property lineage
 * (`/objects/rid/<rid>#prop-<prop>`) with property display name and value.
 */

import {screen, waitFor, within} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {describe, expect, it} from 'vitest';
import * as fx from '../../../test/fixtures';
import {renderWithProviders} from '../../../test/render';
import {EvidenceChain} from './evidence_chain';

describe('EvidenceChain', () => {
  it('links each evidence item to the object property with name and value', async () => {
    renderWithProviders(
      <EvidenceChain evidence={fx.recommendation.evidence} />,
    );
    const list = await screen.findByRole('list', {name: '证据链'});
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(2);

    expect(links[0]).toHaveAttribute(
      'href',
      `/objects/rid/${fx.rid('Supplier', 'S002')}#prop-riskScore`,
    );
    // Property display names come from the (async) UI model.
    await waitFor(() => expect(links[0]).toHaveTextContent('风险分'));
    expect(links[0]).toHaveTextContent('78');
    expect(links[0]).toHaveTextContent('来源 src-suppliers');
    expect(links[0]).toHaveTextContent('可信度 95%');

    expect(links[1]).toHaveAttribute(
      'href',
      `/objects/rid/${fx.rid('Supplier', 'S003')}#prop-capacity`,
    );
    expect(links[1]).toHaveTextContent('产能');
    expect(links[1]).toHaveTextContent('1,500');

    // Object titles are resolved via the object query.
    expect(
      await within(list).findByText('Hanoi Circuit Works'),
    ).toBeInTheDocument();
    expect(await within(list).findByText('Penang Semicon')).toBeInTheDocument();
  });

  it('is keyboard reachable', async () => {
    renderWithProviders(
      <EvidenceChain evidence={fx.recommendation.evidence} />,
    );
    const list = await screen.findByRole('list', {name: '证据链'});
    const user = userEvent.setup();
    await user.tab();
    expect(within(list).getAllByRole('link')[0]).toHaveFocus();
    await user.tab();
    expect(within(list).getAllByRole('link')[1]).toHaveFocus();
  });

  it('shows an empty state without evidence', async () => {
    renderWithProviders(<EvidenceChain evidence={[]} />);
    expect(await screen.findByText('暂无证据')).toBeInTheDocument();
  });
});
