export type QueryCheck = { safe: boolean; message: string };

const BLOCKED_SQL = /\b(insert|update|delete|merge|alter|drop|truncate|create|grant|revoke|execute|call|commit|rollback)\b/i;

export function removeSqlComments(query: string) {
  return query.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "").trim();
}

export function checkReadOnlySql(query: string): QueryCheck {
  const statement = removeSqlComments(query).replace(/;\s*$/, "");
  if (!statement) return { safe: false, message: "Enter a SQL query before saving." };
  if (statement.includes(";")) return { safe: false, message: "Only one SQL statement is allowed." };
  if (!/^(select|with)\b/i.test(statement)) return { safe: false, message: "Only SELECT or WITH queries are allowed." };
  if (BLOCKED_SQL.test(statement)) return { safe: false, message: "Write or administration SQL is not allowed in validations." };
  return { safe: true, message: "Read-only SQL check passed." };
}

export function safeSqlCleanup(query: string) {
  return query
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/\r\n/g, "\n")
    .trim();
}

export function formatSql(query: string) {
  let value = safeSqlCleanup(query).replace(/[\t ]+/g, " ").replace(/ *\n */g, "\n");
  const keywords = ["group by", "order by", "left outer join", "right outer join", "inner join", "left join", "right join", "union all", "select", "from", "where", "having", "join", "union", "with", "and", "or", "case", "when", "then", "else", "end", "on", "as"];
  for (const keyword of keywords) {
    const pattern = new RegExp(`\\b${keyword.replace(/ /g, "\\s+")}\\b`, "gi");
    value = value.replace(pattern, keyword.toUpperCase());
  }
  value = value
    .replace(/\s+(FROM|WHERE|GROUP BY|ORDER BY|HAVING|LEFT OUTER JOIN|RIGHT OUTER JOIN|INNER JOIN|LEFT JOIN|RIGHT JOIN|JOIN|UNION ALL|UNION)\b/g, "\n$1")
    .replace(/\s+(AND|OR)\b/g, "\n  $1")
    .replace(/\bON\s+/g, "ON ")
    .replace(/\n{3,}/g, "\n\n");
  return value.trim();
}
