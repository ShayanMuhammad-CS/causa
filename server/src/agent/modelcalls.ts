// Model proof (NVIDIA award: "show which model handled the request"): every LLM call becomes a `model_call`
// event carrying the model the PROVIDER reported in its response (not the one we asked for), the provider and
// latency. Calls made inside the agent loop are recorded by its metered chat; calls made by other modules on the
// agent's behalf (Scout Intent classification) go through instrumentLLM, which reports to the investigation that
// is currently running via AsyncLocalStorage.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ChatResponse, InvestigationEvent, LLM } from '../types';

export type ModelCallEvent = Extract<InvestigationEvent, { type: 'model_call' }>;
export type ModelRole = ModelCallEvent['role'];
export type ModelProvider = ModelCallEvent['provider'];

export const modelCallScope = new AsyncLocalStorage<{ emit: (e: InvestigationEvent) => void; onModel?: (model: string) => void }>();

type WithHandledBy = ChatResponse & { handledBy?: { provider?: string; model?: string } };

/** Provider label for the event. Anything that is not Nightshift or NVIDIA direct is the offline sample path. */
export function providerOf(res: ChatResponse): ModelProvider {
  const p = ((res as WithHandledBy).handledBy?.provider ?? '').toLowerCase();
  if (p.startsWith('meterless')) return 'meterless-nightshift';
  if (p.startsWith('nvidia')) return 'nvidia-direct';
  return 'sample';
}

/** The model id the provider reported in its response (falls back to ChatResponse.model). */
export function modelOf(res: ChatResponse): string {
  return (res as WithHandledBy).handledBy?.model || res.model;
}

export function modelCallEvent(role: ModelRole, res: ChatResponse, ms: number): ModelCallEvent {
  return { type: 'model_call', role, model: modelOf(res), provider: providerOf(res), ms };
}

/** Wrap an LLM so each chat() reports a model_call (with `role`) to the investigation currently in scope. */
export function instrumentLLM<T extends LLM>(llm: T, role: ModelRole): T {
  return new Proxy(llm, {
    get(target, prop, receiver) {
      if (prop === 'chat') {
        return async (...args: Parameters<LLM['chat']>) => {
          const started = Date.now();
          const res = await target.chat(...args);
          const scope = modelCallScope.getStore();
          if (scope) {
            scope.onModel?.(modelOf(res));
            scope.emit(modelCallEvent(role, res, Date.now() - started));
          }
          return res;
        };
      }
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
