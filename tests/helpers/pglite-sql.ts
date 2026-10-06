import type postgres from 'postgres';

type Engine = { query: (query: string, parameters?: unknown[]) => Promise<{ rows: unknown[] }> };
const jsonMarker = Symbol('bound-json');
const identifierMarker = Symbol('sql-identifier');

// Runs the same parameterized server queries through PostgreSQL in memory.
// It is a test adapter, never imported by application routes.
export function sqlAdapter(engine: Engine, transaction?: (callback: (engine: Engine) => Promise<unknown>) => Promise<unknown>): postgres.Sql {
  const tag = (parts: TemplateStringsArray | string, ...values: unknown[]) => {
    if (typeof parts === 'string') return { [identifierMarker]: parts };
    const parameters: unknown[] = [];
    const query = parts.reduce((result, part, i) => {
      if (i >= values.length) return result + part;
      const value = values[i];
      if (value && typeof value === 'object' && identifierMarker in value) {
        const identifier = String((value as Record<symbol, unknown>)[identifierMarker]);
        return result + part + `"${identifier.replaceAll('"', '""')}"`;
      }
      parameters.push(value && typeof value === 'object' && jsonMarker in value ? (value as Record<symbol, unknown>)[jsonMarker] : value);
      return result + part + `$${parameters.length}`;
    }, '');
    return engine.query(query, parameters).then(result => result.rows);
  };
  Object.assign(tag, {
    json: (value: unknown) => ({ [jsonMarker]: JSON.stringify(value) }),
    unsafe: async (query: string) => (await engine.query(query)).rows,
    begin: async (callback: (sql: postgres.Sql) => Promise<unknown>) => transaction ? transaction(tx => callback(sqlAdapter(tx))) : callback(tag as unknown as postgres.Sql),
  });
  return tag as unknown as postgres.Sql;
}
