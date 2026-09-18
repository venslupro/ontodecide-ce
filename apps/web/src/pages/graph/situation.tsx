/**
 * GraphSituationPage — situation / event detail.
 * Reads :id from URL and fetches the enriched SituationNode from the
 * Graph service, rendering entity details, its relations, and a
 * recommendations section.
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Button from '@/components/ui/Button';
import Badge from '@/components/ui/Badge';
import Tag from '@/components/ui/Tag';
import { Card, CardHeader, CardContent } from '@/components/ui/Card';
import { situationResource } from '@/services/api';
import type { SituationNode } from '@ontodecide/shared';

export default function GraphSituationPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [situation, setSituation] = useState<SituationNode | null>(null);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    situationResource
      .get(id)
      .then((res) => {
        if (!res.success) {
          setError(res.error?.message ?? 'Failed to load situation.');
        } else {
          setSituation(res.data ?? null);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, [id]);

  const entity = situation?.entity;
  const relations = situation?.relations ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {/* Header card */}
      <Card>
        <CardContent style={{
          display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
          gap: 'var(--space-3)', flexWrap: 'wrap',
        }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
            <div style={{
              width: 56, height: 56, borderRadius: 16, flexShrink: 0,
              background: 'var(--color-primary-50)',
              color: 'var(--color-primary)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 26,
            }}>🟢</div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                <h1 style={{ fontSize: 22, fontWeight: 700, color: 'var(--color-neutral-900)' }}>
                  {loading ? 'Loading…' : entity?.id ?? 'Entity not found'}
                </h1>
                {entity && <Badge tone="primary">{entity.type}</Badge>}
              </div>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, color: 'var(--color-neutral-500)' }}>
                <span>Entity ID: <code style={{
                  background: 'var(--color-neutral-100)',
                  padding: '2px 6px', borderRadius: 4, fontSize: 12,
                }}>{id}</code></span>
                {entity && (
                  <>
                    <span>Source: <strong style={{ color: 'var(--color-neutral-700)' }}>{entity.source}</strong></span>
                    <span>Confidence: <strong style={{ color: 'var(--color-neutral-900)' }}>{entity.confidence}</strong></span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="outline" size="md" onClick={() => navigate(-1)}>← Back</Button>
            <Button variant="primary" size="md" onClick={() => navigate(`/graph/explore?id=${encodeURIComponent(id)}`)}>
              Explore graph →
            </Button>
          </div>
        </CardContent>
      </Card>

      {error && (
        <Card>
          <CardContent style={{ color: 'var(--color-danger)', fontSize: 14 }}>
            Failed to load situation: {error}
          </CardContent>
        </Card>
      )}

      {loading && (
        <Card>
          <CardContent style={{ color: 'var(--color-neutral-500)', fontSize: 14 }}>Loading situation details…</CardContent>
        </Card>
      )}

      {!loading && !error && entity && (
        <div className="g12">
          <div style={{ gridColumn: 'span 7', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* Entity attributes */}
            <Card>
              <CardHeader>
                <h2 style={{ fontSize: 15, fontWeight: 600 }}>Entity attributes</h2>
                <Badge tone="info">{Object.keys(entity.attributes).length} keys</Badge>
              </CardHeader>
              <CardContent>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {Object.entries(entity.attributes).map(([key, value]) => (
                    <div key={key} style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: 'var(--color-neutral-50)',
                      borderRadius: 'var(--radius-sm)',
                      border: '1px solid var(--color-neutral-200)',
                    }}>
                      <span style={{ fontSize: 13, color: 'var(--color-neutral-600)' }}>{key}</span>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
                        {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                      </span>
                    </div>
                  ))}
                  {Object.keys(entity.attributes).length === 0 && (
                    <span style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>No attributes.</span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <div style={{ gridColumn: 'span 5', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* Relations */}
            <Card>
              <CardHeader>
                <h2 style={{ fontSize: 15, fontWeight: 600 }}>Relations</h2>
                <Badge tone="primary">{relations.length}</Badge>
              </CardHeader>
              <CardContent>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {relations.map((r, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => navigate(`/graph/situation/${encodeURIComponent(r.target.id)}`)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10,
                        padding: '10px 12px', borderRadius: 'var(--radius-sm)',
                        border: '1px solid var(--color-neutral-200)',
                        background: '#fff', cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <Tag tone="primary">{r.type}</Tag>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--color-neutral-900)' }}>
                        {r.target.id}
                      </span>
                      <Badge tone="default">{r.target.type}</Badge>
                    </button>
                  ))}
                  {relations.length === 0 && (
                    <span style={{ fontSize: 13, color: 'var(--color-neutral-400)' }}>No relations.</span>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
