import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  artifactListResponseSchema,
  configurationValidationResponseSchema,
  datasetAnalysisResponseSchema,
  datasetDtoSchema,
  datasetListResponseSchema,
  datasetRowsResponseSchema,
  decisionListResponseSchema,
  exportStatusResponseSchema,
  fileAssetDtoSchema,
  fileListResponseSchema,
  healthResponseSchema,
  metaResponseSchema,
  reviewHistoryResponseSchema,
  reviewItemDtoSchema,
  reviewItemListResponseSchema,
  reviewQueueResponseSchema,
  ruleSetDtoSchema,
  ruleSetListResponseSchema,
  ruleSetValidationResponseSchema,
  runDtoSchema,
  runListResponseSchema,
  savedWorkflowDetailDtoSchema,
  savedWorkflowListResponseSchema,
  prepareSavedWorkflowRunResponseSchema,
  invitationDtoSchema,
  invitationListResponseSchema,
  workspaceDetailDtoSchema,
  workspaceDtoSchema,
  workspaceListResponseSchema,
  workflowConfigurationDtoSchema,
  workflowConfigurationListResponseSchema,
  workflowDetailDtoSchema,
  workflowListResponseSchema,
  type CreateRuleSetRequest,
  type MembershipRole,
  type CreateRunRequest,
  type CreateWorkflowConfigurationRequest,
  type PrepareSavedWorkflowRunRequest,
  type ResolveReviewItemRequest,
  type ReviewFilter,
  type RunSavedWorkflowRequest,
  type UpdateRuleSetRequest,
  type UpdateWorkflowConfigurationRequest,
  type ValidateRuleSetRequest,
  type ValidateWorkflowConfigurationRequest,
} from '@sheetpilot/core';
import { fetchSession, type Session } from './auth.js';
import { apiGet, apiPost, apiPut, apiSend, apiUpload } from './client.js';

export const queryKeys = {
  session: ['session'] as const,
  health: ['health'] as const,
  meta: ['meta'] as const,
  workflows: ['workflows'] as const,
  workflow: (slug: string) => ['workflows', slug] as const,
  runs: ['runs'] as const,
  run: (id: string) => ['runs', id] as const,
  decisions: (runId: string) => ['runs', runId, 'decisions'] as const,
  runReviewItems: (runId: string) => ['runs', runId, 'review-items'] as const,
  artifacts: (runId: string) => ['runs', runId, 'artifacts'] as const,
  runExport: (runId: string) => ['runs', runId, 'export'] as const,
  reviewQueue: (filter: string, runId?: string) =>
    ['review-items', filter, runId ?? 'all'] as const,
  reviewHistory: (itemId: string) => ['review-items', itemId, 'history'] as const,
  files: ['files'] as const,
  datasets: ['datasets'] as const,
  dataset: (id: string) => ['datasets', id] as const,
  datasetAnalysis: (id: string, sheet: string) => ['datasets', id, 'analysis', sheet] as const,
  datasetRows: (id: string, sheet: string, offset: number) =>
    ['datasets', id, 'rows', sheet, offset] as const,
  workflowConfigurations: ['workflow-configurations'] as const,
  workflowConfigurationsBySlug: (slug: string) =>
    ['workflow-configurations', 'slug', slug] as const,
  workflowConfiguration: (id: string) => ['workflow-configurations', id] as const,
  ruleSets: (slug?: string) => ['rule-sets', slug ?? 'all'] as const,
  ruleSet: (id: string) => ['rule-sets', id] as const,
  savedWorkflows: ['saved-workflows'] as const,
  savedWorkflow: (id: string) => ['saved-workflows', id] as const,
  workspaces: ['workspaces'] as const,
  currentWorkspace: ['workspaces', 'current'] as const,
};

export function useSession() {
  return useQuery<Session | null>({
    queryKey: queryKeys.session,
    queryFn: fetchSession,
    staleTime: 30_000,
  });
}

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

export function useRunExport(runId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.runExport(runId ?? ''),
    queryFn: () => apiGet(`/api/v1/runs/${runId}/export`, exportStatusResponseSchema),
    enabled: Boolean(runId),
    refetchInterval: 5000,
  });
}

export function useReviewQueue(filter: ReviewFilter, runId?: string) {
  const params = new URLSearchParams();
  if (filter !== 'all') {
    params.set('filter', filter);
  }
  params.set('limit', '200');
  if (runId) {
    params.set('runId', runId);
  }
  return useQuery({
    queryKey: queryKeys.reviewQueue(filter, runId),
    queryFn: () => apiGet(`/api/v1/review-items?${params.toString()}`, reviewQueueResponseSchema),
    refetchInterval: 5000,
  });
}

export function useReviewHistory(itemId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.reviewHistory(itemId ?? ''),
    queryFn: () => apiGet(`/api/v1/review-items/${itemId}/history`, reviewHistoryResponseSchema),
    enabled: Boolean(itemId),
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

export function useDatasets() {
  return useQuery({
    queryKey: queryKeys.datasets,
    queryFn: () => apiGet('/api/v1/datasets?limit=100', datasetListResponseSchema),
  });
}

export function useDataset(datasetId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.dataset(datasetId ?? ''),
    queryFn: () => apiGet(`/api/v1/datasets/${datasetId}`, datasetDtoSchema),
    enabled: Boolean(datasetId),
  });
}

export function useDatasetAnalysis(datasetId: string | undefined, sheetName: string | null) {
  const sheet = sheetName ?? '';
  return useQuery({
    queryKey: queryKeys.datasetAnalysis(datasetId ?? '', sheet),
    queryFn: () =>
      apiGet(
        `/api/v1/datasets/${datasetId}/analysis${sheet ? `?sheet=${encodeURIComponent(sheet)}` : ''}`,
        datasetAnalysisResponseSchema,
      ),
    enabled: Boolean(datasetId),
  });
}

export function useDatasetRows(
  datasetId: string | undefined,
  sheetName: string | null,
  limit: number,
  offset: number,
) {
  const sheet = sheetName ?? '';
  return useQuery({
    queryKey: queryKeys.datasetRows(datasetId ?? '', sheet, offset),
    queryFn: () =>
      apiGet(
        `/api/v1/datasets/${datasetId}/rows?limit=${limit}&offset=${offset}${
          sheet ? `&sheet=${encodeURIComponent(sheet)}` : ''
        }`,
        datasetRowsResponseSchema,
      ),
    enabled: Boolean(datasetId),
  });
}

export function useUploadDataset() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { kind: string; file: File; sheet?: string }) => {
      const form = new FormData();
      form.set('kind', input.kind);
      form.set('file', input.file);
      if (input.sheet) {
        form.set('sheet', input.sheet);
      }
      return apiUpload('/api/v1/datasets', form, datasetDtoSchema);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.datasets });
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

export function useDatasetDetails(ids: string[]) {
  return useQueries({
    queries: ids.map((id) => ({
      queryKey: queryKeys.dataset(id),
      queryFn: () => apiGet(`/api/v1/datasets/${id}`, datasetDtoSchema),
      enabled: Boolean(id),
    })),
  });
}

export function useWorkflowConfigurations(workflowSlug?: string) {
  const query = workflowSlug
    ? `?workflowSlug=${encodeURIComponent(workflowSlug)}&limit=100`
    : '?limit=100';
  return useQuery({
    queryKey: workflowSlug
      ? queryKeys.workflowConfigurationsBySlug(workflowSlug)
      : queryKeys.workflowConfigurations,
    queryFn: () =>
      apiGet(`/api/v1/workflow-configurations${query}`, workflowConfigurationListResponseSchema),
  });
}

export function useWorkflowConfiguration(configurationId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.workflowConfiguration(configurationId ?? ''),
    queryFn: () =>
      apiGet(`/api/v1/workflow-configurations/${configurationId}`, workflowConfigurationDtoSchema),
    enabled: Boolean(configurationId),
  });
}

export function useValidateWorkflowConfiguration() {
  return useMutation({
    mutationFn: (input: ValidateWorkflowConfigurationRequest) =>
      apiPost(
        '/api/v1/workflow-configurations/validate',
        input,
        configurationValidationResponseSchema,
      ),
  });
}

export function useCreateWorkflowConfiguration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateWorkflowConfigurationRequest) =>
      apiPost('/api/v1/workflow-configurations', input, workflowConfigurationDtoSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowConfigurations });
    },
  });
}

export function useUpdateWorkflowConfiguration() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: UpdateWorkflowConfigurationRequest }) =>
      apiPut(
        `/api/v1/workflow-configurations/${input.id}`,
        input.body,
        workflowConfigurationDtoSchema,
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workflowConfigurations });
    },
  });
}

export function useRuleSets(workflowSlug?: string) {
  const query = workflowSlug ? `?workflowSlug=${encodeURIComponent(workflowSlug)}` : '';
  return useQuery({
    queryKey: queryKeys.ruleSets(workflowSlug),
    queryFn: () => apiGet(`/api/v1/rule-sets${query}`, ruleSetListResponseSchema),
  });
}

export function useRuleSet(ruleSetId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.ruleSet(ruleSetId ?? ''),
    queryFn: () => apiGet(`/api/v1/rule-sets/${ruleSetId}`, ruleSetDtoSchema),
    enabled: Boolean(ruleSetId),
  });
}

export function useValidateRuleSet() {
  return useMutation({
    mutationFn: (input: ValidateRuleSetRequest) =>
      apiPost('/api/v1/rule-sets/validate', input, ruleSetValidationResponseSchema),
  });
}

export function useCreateRuleSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateRuleSetRequest) =>
      apiPost('/api/v1/rule-sets', input, ruleSetDtoSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['rule-sets'] });
    },
  });
}

export function useUpdateRuleSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: UpdateRuleSetRequest }) =>
      apiPut(`/api/v1/rule-sets/${input.id}`, input.body, ruleSetDtoSchema),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ['rule-sets'] });
      void queryClient.invalidateQueries({ queryKey: queryKeys.ruleSet(variables.id) });
    },
  });
}

export function useSavedWorkflows() {
  return useQuery({
    queryKey: queryKeys.savedWorkflows,
    queryFn: () => apiGet('/api/v1/saved-workflows', savedWorkflowListResponseSchema),
    refetchInterval: 10_000,
  });
}

export function useSavedWorkflow(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.savedWorkflow(id ?? ''),
    queryFn: () => apiGet(`/api/v1/saved-workflows/${id}`, savedWorkflowDetailDtoSchema),
    enabled: Boolean(id),
  });
}

export function usePrepareSavedWorkflowRun() {
  return useMutation({
    mutationFn: (input: { id: string; body: PrepareSavedWorkflowRunRequest }) =>
      apiPost(
        `/api/v1/saved-workflows/${input.id}/prepare`,
        input.body,
        prepareSavedWorkflowRunResponseSchema,
      ),
  });
}

export function useRunSavedWorkflow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { id: string; body: RunSavedWorkflowRequest }) =>
      apiPost(`/api/v1/saved-workflows/${input.id}/run`, input.body, runDtoSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.runs });
      void queryClient.invalidateQueries({ queryKey: queryKeys.savedWorkflows });
    },
  });
}

export function useWorkspaces(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.workspaces,
    queryFn: () => apiGet('/api/v1/workspaces', workspaceListResponseSchema),
    enabled,
  });
}

export function useCurrentWorkspace(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.currentWorkspace,
    queryFn: () => apiGet('/api/v1/workspaces/current', workspaceDetailDtoSchema),
    enabled,
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => apiPost('/api/v1/workspaces', { name }, workspaceDtoSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.workspaces });
    },
  });
}

export function useActivateWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) =>
      apiSend(`/api/v1/workspaces/${workspaceId}/activate`, 'POST'),
    onSuccess: () => {
      // Every cached query is scoped to the active workspace, so none of it may survive a switch.
      void queryClient.resetQueries();
    },
  });
}

export function useRenameWorkspace() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      apiPut('/api/v1/workspaces/current', { name }, workspaceDtoSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useUpdateMemberRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { membershipId: string; role: MembershipRole }) =>
      apiSend(`/api/v1/workspaces/current/members/${input.membershipId}`, 'PUT', {
        role: input.role,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) =>
      apiSend(`/api/v1/workspaces/current/members/${membershipId}`, 'DELETE'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useInvitations(enabled: boolean) {
  return useQuery({
    queryKey: ['workspaces', 'invitations'],
    queryFn: () => apiGet('/api/v1/workspaces/current/invitations', invitationListResponseSchema),
    enabled,
  });
}

export function useInviteMember() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: MembershipRole }) =>
      apiPost('/api/v1/workspaces/current/invitations', input, invitationDtoSchema),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
    },
  });
}

export function useRevokeInvitation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (invitationId: string) =>
      apiSend(`/api/v1/workspaces/current/invitations/${invitationId}`, 'DELETE'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['workspaces'] });
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
