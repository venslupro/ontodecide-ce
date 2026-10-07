/**
 * @fileoverview Data integration DTOs (详细设计 6.11.2). File import only:
 * the browser parses CSV / XLSX / JSON and uploads rows in batches of ≤ 100,
 * written synchronously to object-graph. Raw files are never stored.
 */

/** A raw source row (column → cell value). */
export type Row = Record<string, unknown>;

/** How a mapped field was matched in a mapping draft. */
export type MatchedBy = 'exact' | 'synonym' | 'similarity' | 'ai' | 'manual';

/**
 * Field mapping from source rows to one object type. `transform` is a chain
 * such as `trim|toNumber|clamp(0,100)` (≤ 5 steps).
 */
export interface MappingSpec {
  targetType: string;
  primaryKey: {from: string; transform?: string};
  fields: {
    to: string;
    from: string;
    transform?: string;
    matchedBy?: MatchedBy;
  }[];
  /** Links created from each row; `toKey` names the column with the target key. */
  links?: {
    type: string;
    toType: string;
    toKey: string;
    /** Splits a multi-valued cell, e.g. `;`. */
    split?: string;
    weightFrom?: string;
  }[];
}

/** Row checks performed (the UI step is called 「校验」 / Validate). */
export type RowCheck = 'required' | 'type' | 'primaryKeyConflict';

/** Import job status. A job without batches for 30 min reads as FAILED. */
export type JobStatus = 'RECEIVING' | 'DONE' | 'FAILED';

/** A rejected row (column and error type only, never the cell value). */
export interface RejectDto {
  row: number;
  code: string;
  column?: string;
  detail?: string;
}

/** Import job. */
export interface JobDto {
  id: string;
  kind: 'file' | 'sample';
  fileName: string | null;
  targetType: string;
  mapping: MappingSpec | null;
  status: JobStatus;
  totalRows: number;
  received: number;
  upserted: number;
  skipped: number;
  rejected: number;
  createdAt: string;
  updatedAt: string;
  /** First ≤ 200 rejects (GET /imports/{id} only). */
  rejects?: RejectDto[];
}

/** Result of one batch (a retried seq returns the stored result). */
export interface BatchResult {
  seq: number;
  upserted: number;
  skipped: number;
  rejected: RejectDto[];
  job: Pick<
    JobDto,
    'status' | 'received' | 'upserted' | 'skipped' | 'rejected'
  >;
}

/** Mapping draft: deterministic matches first, then AI for the rest. */
export interface MappingDraft extends MappingSpec {
  rankedBy: 'ai' | 'rules';
  /** Source fields left unmatched. */
  unmatched: string[];
}

/** Input of POST /imports. */
export interface CreateImportInput {
  fileName: string;
  targetType: string;
  totalRows: number;
  mapping?: MappingSpec;
}

/** Input of POST /imports/{id}/batches. */
export interface BatchInput {
  seq: number;
  last: boolean;
  /** ≤ 100 rows. */
  rows: Row[];
}

/** Input of POST /imports/{id}/mapping-draft. */
export interface MappingDraftInput {
  fields: string[];
  /** ≤ 20 sample rows, aligned with `fields`. */
  sampleRows: unknown[][];
  targetType: string;
}

/** Sample scenario size (80 objects, 160 links). */
export const SAMPLE_SCENARIO = {objects: 80, links: 160} as const;

/**
 * Scenario metadata safe to ship to the frontend (no sample data). The
 * system is not coupled to any scenario — these six ship with the product,
 * but users may also import their own CSV / XLSX / JSON data.
 */
export interface ScenarioMeta {
  id: string;
  name: {'zh-CN': string; 'en-US': string};
  description: {'zh-CN': string; 'en-US': string};
  objects: number;
  links: number;
}

/** Built-in example scenarios (metadata only; sample data lives in domain). */
export const BUILT_IN_SCENARIOS: readonly ScenarioMeta[] = [
  {
    id: 'supply-chain',
    name: {
      'zh-CN': '供应链风险监测与预警',
      'en-US': 'Supply Chain Risk Monitoring',
    },
    description: {
      'zh-CN': '贯通上下游数据流，识别断链与瓶颈节点，提前预警供应链风险。',
      'en-US':
        'End-to-end supply and demand visibility to detect disruptions and bottlenecks early.',
    },
    objects: 80,
    links: 160,
  },
  {
    id: 'urban-emergency',
    name: {
      'zh-CN': '城市态势感知与应急指挥',
      'en-US': 'Urban Situational Awareness & Emergency',
    },
    description: {
      'zh-CN': '融合交通、安防、事件多源数据，实时呈现城市运行态势。',
      'en-US':
        'Fuse traffic, security and incident data for real-time city situational awareness.',
    },
    objects: 30,
    links: 18,
  },
  {
    id: 'predictive-maintenance',
    name: {
      'zh-CN': '工业设备预测性维护',
      'en-US': 'Industrial Predictive Maintenance',
    },
    description: {
      'zh-CN': '汇聚 IoT 传感器与运维数据，预测设备健康状态与故障趋势。',
      'en-US':
        'Aggregate IoT sensor and maintenance data to predict equipment health and failures.',
    },
    objects: 33,
    links: 23,
  },
  {
    id: 'financial-fraud',
    name: {
      'zh-CN': '金融反欺诈与合规监测',
      'en-US': 'Financial Anti-Fraud & Compliance',
    },
    description: {
      'zh-CN': '实时关联交易、行为与图谱数据，精准识别异常模式。',
      'en-US':
        'Correlate transactions, behaviour and graph data to spot anomalous patterns.',
    },
    objects: 35,
    links: 42,
  },
  {
    id: 'energy-grid',
    name: {
      'zh-CN': '能源电网运行优化',
      'en-US': 'Energy Grid Operation Optimization',
    },
    description: {
      'zh-CN': '融合负荷、新能源出力与设备状态，优化电网运行策略。',
      'en-US':
        'Fuse load, renewable output and equipment state to optimise grid operation.',
    },
    objects: 26,
    links: 28,
  },
  {
    id: 'intelligence-fusion',
    name: {
      'zh-CN': '多源情报融合分析',
      'en-US': 'Multi-source Intelligence Fusion',
    },
    description: {
      'zh-CN': '结构化与文本情报统一建模，构建关联网络辅助研判。',
      'en-US':
        'Unify structured and text intelligence into a linked graph for analysis.',
    },
    objects: 33,
    links: 48,
  },
];

/**
 * A built-in example scenario: an ontology template id plus the sample
 * datasets (rows + mapping) that populate it. The system is not coupled to
 * any scenario — users may also import their own CSV / XLSX / JSON data —
 * but these six ship with the product so a new workspace can be explored
 * immediately.
 */
export interface SampleScenario extends ScenarioMeta {
  /** Ontology template applied before loading the sample data. */
  templateId: string;
  /** Datasets written in order (link targets first). */
  datasets: () => SampleDataset[];
  /** D1 rows reserved against the daily seed budget. */
  seedRows: number;
}

/** One sample dataset: rows of one object type and their mapping. */
export interface SampleDataset {
  /** CSV file name under samples/<scenario>. */
  file: string;
  mapping: MappingSpec;
  rows: Row[];
}
