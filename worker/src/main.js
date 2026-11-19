// Production entry: wires the Durable Object state store in front of the existing Worker.
import worker from './index.js';
import { storeAdapter } from './state.js';
export { Store } from './store-do.js';

export const withStore = (env) => (env.STORE
  ? { ...env, STATE: storeAdapter(env.STORE.get(env.STORE.idFromName('state')), env.STATE) }
  : env);

export default {
  fetch: (request, env, ctx) => worker.fetch(request, withStore(env), ctx),
  scheduled: (event, env, ctx) => worker.scheduled(event, withStore(env), ctx),
};
