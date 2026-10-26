export const DEFAULT_ROOTS: readonly string[] = ["~/work/*"];

export const underRoots = (
  cwd: string,
  roots: readonly string[],
  home: string
): boolean =>
  roots.some((pattern) => {
    const expanded = pattern.replace(/^~\//u, `${home}/`).replace(/\/+$/u, "");

    if (expanded.endsWith("/*")) {
      const base = expanded.slice(0, -2);

      return cwd === base || cwd.startsWith(`${base}/`);
    }

    if (expanded.endsWith("*")) {
      return cwd.startsWith(expanded.slice(0, -1));
    }

    return cwd === expanded;
  });
