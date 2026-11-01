import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cache = vi.hoisted(() => ({ data: new Map<string, unknown>() }));

vi.mock('@/lib/tauri-api', () => ({
  getCollectionSettings: vi.fn(async () => ({ variables: [], headers: [] })),
  getFolderChainVariables: vi.fn(async () => []),
  getRequestVariables: vi.fn(async () => []),
  getWorkspaceConfig: vi.fn(async () => ({})),
  getProcessEnvVars: vi.fn(async () => ({ vars: {}, dotEnvKeys: [] })),
  getResolvedEnvironment: vi.fn(async (collection: string, name: string) => {
    const envs = (cache.data.get(JSON.stringify(['environments', collection])) ?? []) as {
      name: string;
      variables: unknown[];
    }[];
    return { name, variables: envs.find((e) => e.name === name)?.variables ?? [], warnings: [] };
  }),
  executeRequest: vi.fn(),
  executeGraphQlRequest: vi.fn(),
}));
vi.mock('@/lib/query-client', () => ({
  getQueryClient: () => ({
    getQueryData: (key: unknown) => cache.data.get(JSON.stringify(key)),
    fetchQuery: (opts: { queryFn: () => unknown }) => opts.queryFn(),
    invalidateQueries: vi.fn(),
  }),
}));

import { authToConsoleHeaders, sendRequest } from '@/lib/execute-request';
import { findTabInTree } from '@/lib/pane-utils';
import { environmentKeys } from '@/lib/queries/environment-queries';
import { executeGraphQlRequest, executeRequest } from '@/lib/tauri-api';
import { useConsoleStore } from '@/stores/console-store';
import { useEnvStore } from '@/stores/env-store';
import { usePaneStore } from '@/stores/pane-store';
import type { RequestState, RequestTab } from '@/types/pane-types';

const TAB_ID = 'tab-1';

const execResult = {
  status: 200,
  statusText: 'OK',
  headers: [],
  body: '',
  durationMs: 1,
  ttfbMs: 1,
  sizeBytes: 0,
  testResults: [],
  consoleEntries: [],
};

function makeRequest(): RequestState {
  return {
    requestType: 'http',
    method: 'GET',
    url: 'https://api.test/ping',
    pathParams: [],
    queryParams: [],
    headers: [{ id: 'h1', key: 'X-T', value: '{{token}}', enabled: true }],
    body: { mode: 'none', content: '', formData: [] },
    auth: { authType: 'bearer', bearer: { token: '{{token}}' } } as never,
    settings: {
      verifySsl: true,
      followRedirects: true,
      maxRedirects: 5,
      timeoutMs: 0,
      encodeUrl: true,
    },
    docs: null,
    tags: [],
    assertions: [],
    actions: [],
  };
}

function openTab(request: RequestState) {
  const tab: RequestTab = {
    id: TAB_ID,
    title: 'ping',
    isDirty: false,
    tabType: 'request',
    request,
    response: null,
    source: { collection: 'api', path: 'ping.yml' },
  };
  usePaneStore.getState().reset();
  usePaneStore.getState().openTab(tab);
  // Opening a tab resets the env store, so select the environment afterwards.
  useEnvStore.setState({ activeEnvId: 'dev', activeCollection: 'api' });
  return tab;
}

const httpRow = () => useConsoleStore.getState().entries.find((e) => e.kind === 'http');

describe('sendRequest Console row from the sent request', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    useConsoleStore.setState({ entries: [] });
    cache.data.clear();
    cache.data.set(JSON.stringify(environmentKeys.collection('api')), [
      {
        name: 'dev',
        variables: [{ key: 'token', value: 'tok-old-123456', enabled: true, secret: true }],
      },
    ]);
    vi.mocked(executeRequest).mockResolvedValue(execResult as never);
  });

  it('the_console_row_shows_the_sent_request', async () => {
    vi.mocked(executeRequest).mockResolvedValueOnce({
      ...execResult,
      sentRequest: {
        url: 'https://api.test/ping',
        headers: [{ key: 'X-T', value: 'sent-value', enabled: true }],
        queryParams: [],
        body: null,
        auth: { authType: 'none' },
      },
    } as never);
    openTab(makeRequest());
    await sendRequest(TAB_ID, makeRequest());
    expect(httpRow()?.requestHeaders).toContainEqual({ key: 'X-T', value: 'sent-value' });
  });

  it('the_console_row_masks_the_sent_bearer_token', async () => {
    vi.mocked(executeRequest).mockResolvedValueOnce({
      ...execResult,
      sentRequest: {
        url: 'https://api.test/ping',
        headers: [{ key: 'X-Plain', value: 'say tok-new-7654321 here', enabled: true }],
        queryParams: [],
        body: null,
        auth: { authType: 'bearer', token: 'tok-new-7654321' },
      },
    } as never);
    openTab(makeRequest());
    await sendRequest(TAB_ID, makeRequest());
    const row = httpRow();
    expect(JSON.stringify(row?.requestHeaders)).toContain('tok-new-7654321');
    expect(JSON.stringify(row?.masked?.requestHeaders)).not.toContain('tok-new-7654321');
    expect(row?.masked?.requestHeaders).toContainEqual({ key: 'X-Plain', value: 'say •••••• here' });
  });

  it('a_sent_secret_value_is_masked_in_the_row', async () => {
    vi.mocked(executeRequest).mockResolvedValueOnce({
      ...execResult,
      sentRequest: {
        url: 'https://api.test/ping',
        headers: [{ key: 'X-T', value: 'script-secret-123', enabled: true }],
        queryParams: [],
        body: null,
        auth: { authType: 'none' },
        secretValues: ['script-secret-123'],
      },
    } as never);
    openTab(makeRequest());
    await sendRequest(TAB_ID, makeRequest());
    const row = httpRow();
    expect(JSON.stringify(row?.requestHeaders)).toContain('script-secret-123');
    expect(JSON.stringify(row?.masked?.requestHeaders)).not.toContain('script-secret-123');
  });

  it('without_a_sent_request_the_row_uses_the_input_fields', async () => {
    openTab(makeRequest());
    await sendRequest(TAB_ID, makeRequest());
    expect(httpRow()?.requestHeaders).toContainEqual({ key: 'X-T', value: '{{token}}' });
  });

  it('the_ipc_input_keeps_the_token_placeholder', async () => {
    openTab(makeRequest());
    await sendRequest(TAB_ID, makeRequest());
    const input = vi.mocked(executeRequest).mock.calls[0]?.[0];
    expect(input?.headers).toContainEqual({ key: 'X-T', value: '{{token}}', enabled: true });
  });

  it('the_ipc_input_keeps_the_token_in_the_url_and_json_body', async () => {
    const request = {
      ...makeRequest(),
      url: 'https://api.test/{{token}}',
      method: 'POST' as const,
      body: { mode: 'json', content: '{"t":"{{token}}"}', formData: [] },
    } as RequestState;
    openTab(request);
    await sendRequest(TAB_ID, request);
    const input = vi.mocked(executeRequest).mock.calls[0]?.[0];
    expect(input?.url).toBe('https://api.test/{{token}}');
    expect(input?.body?.content).toBe('{"t":"{{token}}"}');
  });

  it('the_graphql_ipc_input_keeps_the_token_in_query_and_variables', async () => {
    vi.mocked(executeGraphQlRequest).mockResolvedValue(execResult as never);
    const request = {
      ...makeRequest(),
      requestType: 'graphql' as const,
      method: 'POST' as const,
      graphql: { query: 'query { u(id: "{{token}}") { id } }', variables: '{"t":"{{token}}"}' },
    } as RequestState;
    openTab(request);
    await sendRequest(TAB_ID, request);
    const input = vi.mocked(executeGraphQlRequest).mock.calls[0]?.[0];
    expect(input?.query).toBe('query { u(id: "{{token}}") { id } }');
    expect(input?.variables).toBe('{"t":"{{token}}"}');
    expect(executeRequest).not.toHaveBeenCalled();
  });
  it('a_masked_basic_password_keeps_the_response_and_shows_a_masked_header', async () => {
    vi.mocked(executeRequest).mockResolvedValueOnce({
      ...execResult,
      sentRequest: {
        url: 'https://api.test/ping',
        headers: [],
        queryParams: [],
        body: null,
        auth: { authType: 'basic', username: 'user', password: '••••••' },
      },
    } as never);
    openTab(makeRequest());
    await sendRequest(TAB_ID, makeRequest());
    const tab = findTabInTree(usePaneStore.getState().root, TAB_ID)?.tab;
    expect((tab as RequestTab).response?.status).toBe(200);
    expect(httpRow()?.requestHeaders).toContainEqual({
      key: 'Authorization',
      value: 'Basic ••••••',
    });
  });

  it('a_non_ascii_basic_password_does_not_throw', () => {
    const [header] = authToConsoleHeaders({
      authType: 'basic',
      username: 'user',
      password: 'pässwörd€',
    });
    const bytes = Uint8Array.from(atob((header?.value ?? '').replace('Basic ', '')), (c) =>
      c.charCodeAt(0),
    );
    expect(new TextDecoder().decode(bytes)).toBe('user:pässwörd€');
  });

  it('a_console_row_error_never_replaces_the_response', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(useConsoleStore.getState(), 'addHttpEntry').mockImplementation(() => {
      throw new Error('console broke');
    });
    openTab(makeRequest());
    await sendRequest(TAB_ID, makeRequest());
    const tab = findTabInTree(usePaneStore.getState().root, TAB_ID)?.tab;
    expect((tab as RequestTab).response?.status).toBe(200);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('a_tab_without_a_collection_fills_the_active_env_name', async () => {
    const request = makeRequest();
    const tab: RequestTab = {
      id: TAB_ID,
      title: 'Untitled',
      isDirty: false,
      tabType: 'request',
      request,
      response: null,
    };
    usePaneStore.getState().reset();
    usePaneStore.getState().openTab(tab);
    useEnvStore.setState({ activeEnvId: 'dev', activeCollection: 'api' });
    await sendRequest(TAB_ID, request);
    const input = vi.mocked(executeRequest).mock.calls[0]?.[0];
    expect(input?.headers).toContainEqual({ key: 'X-T', value: 'tok-old-123456', enabled: true });
  });

  it('form_keys_and_a_binary_path_are_filled_but_values_keep_the_placeholder', async () => {
    cache.data.set(JSON.stringify(environmentKeys.collection('api')), [
      {
        name: 'dev',
        variables: [
          { key: 'token', value: 'tok-old-123456', enabled: true, secret: false },
          { key: 'fieldName', value: 'fld', enabled: true, secret: false },
          { key: 'dataDir', value: '/data', enabled: true, secret: false },
        ],
      },
    ]);
    const form = {
      ...makeRequest(),
      method: 'POST' as const,
      body: {
        mode: 'formurlencoded',
        content: '',
        formData: [
          { id: 'f1', key: '{{fieldName}}', value: '{{token}}', enabled: true, entryType: 'text' },
        ],
      },
    } as RequestState;
    openTab(form);
    await sendRequest(TAB_ID, form);
    const formInput = vi.mocked(executeRequest).mock.calls[0]?.[0];
    expect(formInput?.body?.formData?.[0]).toMatchObject({ key: 'fld', value: '{{token}}' });

    const binary = {
      ...makeRequest(),
      method: 'POST' as const,
      body: { mode: 'binary', content: '', formData: [], filePath: '{{dataDir}}/up.bin' },
    } as RequestState;
    openTab(binary);
    await sendRequest(TAB_ID, binary);
    const binInput = vi.mocked(executeRequest).mock.calls[1]?.[0];
    expect(binInput?.body?.filePath).toBe('/data/up.bin');
  });
});
