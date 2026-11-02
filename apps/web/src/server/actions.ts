"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { dashboard } from "./session";

const number = (form: FormData, key: string): number => Number(form.get(key));
const text = (form: FormData, key: string): string => String(form.get(key) ?? "").trim();
const maxRuleLength = 2000;

const done = (form: FormData) => revalidatePath(`/app/repos/${text(form, "fullName")}`);

export const addRule = async (form: FormData): Promise<void> => {
  const body = text(form, "text").slice(0, maxRuleLength);

  if (body === "") return;
  await dashboard((service, user) => service.addRule(user, number(form, "repositoryId"), body));
  done(form);
};

export const toggleRule = async (form: FormData): Promise<void> => {
  await dashboard((service, user) =>
    service.setRuleEnabled(user.id, text(form, "ruleId"), text(form, "enabled") === "true"),
  );
  done(form);
};

export const deleteRule = async (form: FormData): Promise<void> => {
  await dashboard((service, user) => service.deleteRule(user.id, text(form, "ruleId")));
  done(form);
};

export const toggleRepository = async (form: FormData): Promise<void> => {
  await dashboard((service, user) =>
    service.setRepositoryEnabled(
      user.id,
      number(form, "repositoryId"),
      text(form, "enabled") === "true",
    ),
  );
  done(form);
};

export const reindex = async (form: FormData): Promise<void> => {
  await dashboard((service, user) => service.reindex(user.id, number(form, "repositoryId")));
  done(form);
};

/** The comment's Retrigger button lands on a confirm page; only this POST queues the review. */
export const retriggerReview = async (form: FormData): Promise<void> => {
  const reviewId = text(form, "reviewId");
  await dashboard((service, user) => service.retrigger(user.id, reviewId));
  redirect(`/app/reviews/${reviewId}?retriggered=1`);
};
