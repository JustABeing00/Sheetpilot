import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  artifactListResponseSchema,
  decisionListResponseSchema,
  fileAssetDtoSchema,
  fileListResponseSchema,
  healthResponseSchema,
  metaResponseSchema,
  reviewItemDtoSchema,
  reviewItemListResponseSchema,
  runDtoSchema,
  runListResponseSchema,
  workflowDetailDtoSchema,
  workflowListResponseSchema,
  type CreateRunRequest,
  type ResolveReviewItemRequest,
} from '@sheetpilot/core';
import { apiGet, apiPost, apiUpload } from './client.js';

export const queryKeys = {
  health: ['health'] as const,
  meta: ['meta'] as const,
  workflows: ['workflows'] as const,
  workflow: (slug: string) => ['workflows', slug] as const,
  runs: ['runs'] as const,
  run: (id: string) => ['runs', id] as const,
  decisions: (runId: string) => ['runs', runId, 'decisions'] as const,
  runReviewItems: (runId: string) => ['runs', runId, 'review-items'] as const,
  artifacts: (runId: string) => ['runs', runId, 'artifacts'] as const,
  reviewQueue: (status: string) => ['review-items', status] as const,
  files: ['files'] as const,
};

export function useHealth() {
  return useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiGet('/healthz', healthResponseSchema),
    refetchInterval: 30_000,
  });
}

export function useMeta() {
  return useQuery({
    queryKey: queryKeys.meta,
    queryFn: () => apiGet('/api/v1/meta', metaResponseSchema),
  });
}

export function useWorkflows() {
  return useQuery({
    queryKey: queryKeys.workflows,
    queryFn: () => apiGet('/api/v1/workflows', workflowListResponseSchema),
  });
}

export function useWorkflow(slug: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workflow(slug ?? ''),
    queryFn: () => apiGet(`/api/v1/workflows/${slug}`, workflowDetailDtoSchema),
    enabled: Boolean(slug),
  });
}

export function useRuns() {
  return useQuery({
    queryKey: queryKeys.runs,
    queryFn: () => apiGet('/api/v1/runs?limit=50', runListResponseSchema),
    refetchInterval: 5000,
  });
}

export function useRun(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.run(runId ?? ''),
    queryFn: () => apiGet(`/api/v1/runs/${runId}`, runDtoSchema),
    enabled: Boolean(runId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'queued' || status === 'running' ? 1000 : false;
    },
  });
}

export function useRunDecisions(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.decisions(runId ?? ''),
    queryFn: () => apiGet(`/api/v1/runs/${runId}/decisions?limit=200`, decisionListResponseSchema),
    enabled: Boolean(runId),
  });
}

export function useRunReviewItems(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.runReviewItems(runId ?? ''),
    queryFn: () => apiGet(`/api/v1/runs/${runId}/review-items`, reviewItemListResponseSchema),
    enabled: Boolean(runId),
  });
}

export function useRunArtifacts(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.artifacts(runId ?? ''),
    queryFn: () => apiGet(`/api/v1/runs/${runId}/artifacts`, artifactListResponseSchema),
    enabled: Boolean(runId),
  });
}

export function useReviewQueue(status: 'open' | 'all') {
  const query = status === 'open' ? '?status=open&limit=200' : '?limit=200';
  return useQuery({
    queryKey: queryKeys.reviewQueue(status),
    queryFn: () => apiGet(`/api/v1/review-items${query}`, reviewItemListResponseSchema),
    refetchInterval: 5000,
  });
}

export function useFiles() {
  return useQuery({
    queryKey: queryKeys.files,
    queryFn: () => apiGet('/api/v1/files?limit=100', fileListResponseSchema),
  });
}

export function useUploadFile() {
  return useMutation({
    mutationFn: async (input: { kind: string; file: File }) => {
      const form = new FormData();
      form.set('kind', input.kind);
      form.set('file', input.file);
      return apiUpload('/api/v1/files', form, fileAssetDtoSchema);
    },
  });
}

export function useCreateRun() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRunRequest) => apiPost('/api/v1/runs', input, runDtoSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs });
    },
  });
}

export function useResolveReviewItem() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: ResolveReviewItemRequest }) =>
      apiPost(`/api/v1/review-items/${input.id}/resolve`, input.body, reviewItemDtoSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['review-items'] });
      void queryClient.invalidateQueries({ queryKey: ['runs'] });
    },
  });
}
