import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import {
  cancellationPolicies,
  cancellationPolicyRules,
  getDb,
} from "@/lib/db";
import type {
  CancellationPolicy,
  CancellationPolicyRule,
} from "@/lib/db/schema";

export type PolicyWithRules = CancellationPolicy & {
  rules: CancellationPolicyRule[];
};

export async function listPolicies(
  locationId: string,
): Promise<PolicyWithRules[]> {
  const db = getDb();
  const policies = await db
    .select()
    .from(cancellationPolicies)
    .where(eq(cancellationPolicies.locationId, locationId))
    .orderBy(asc(cancellationPolicies.name));
  if (policies.length === 0) return [];
  const rules = await db
    .select()
    .from(cancellationPolicyRules)
    .where(
      inArray(
        cancellationPolicyRules.policyId,
        policies.map((p) => p.id),
      ),
    )
    .orderBy(asc(cancellationPolicyRules.hoursBeforeStart));
  return policies.map((p) => ({
    ...p,
    rules: rules.filter((r) => r.policyId === p.id),
  }));
}

export async function getPolicy(
  id: string,
  locationId: string,
): Promise<PolicyWithRules | null> {
  const db = getDb();
  const p = (
    await db
      .select()
      .from(cancellationPolicies)
      .where(eq(cancellationPolicies.id, id))
      .limit(1)
  )[0];
  if (!p || p.locationId !== locationId) return null;
  const rules = await db
    .select()
    .from(cancellationPolicyRules)
    .where(eq(cancellationPolicyRules.policyId, id))
    .orderBy(asc(cancellationPolicyRules.hoursBeforeStart));
  return { ...p, rules };
}
