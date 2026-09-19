import { GraphData, Topic } from '../../lib/graph/types';
import { generateKnowledgeGraph as buildGraph } from '../../lib/graph/generate';
import { getTopicCatalog } from '../../lib/graph/catalog';

export interface GenerateGraphActionParams {
  ratings?: Record<string, number | null | undefined>;
  targetCompany?: string;
  placementTimeline?: string;
  catalog?: Topic[];
}

/**
 * Server action to generate the personal Knowledge Graph from catalog and ratings.
 * Deterministic without any required LLM call.
 */
export async function generateKnowledgeGraphAction(
  params: GenerateGraphActionParams
): Promise<GraphData> {
  const graph = buildGraph({
    catalog: params.catalog || getTopicCatalog('onboarding'),
    ratings: params.ratings,
    targetCompany: params.targetCompany,
    timeline: params.placementTimeline,
  });

  return graph;
}

// Default export alias
export default generateKnowledgeGraphAction;
