CREATE TABLE "code_file" (
	"repositoryId" bigint,
	"path" text,
	"hash" text NOT NULL,
	"language" text,
	"content" text NOT NULL,
	CONSTRAINT "code_file_pkey" PRIMARY KEY("repositoryId","path")
);
--> statement-breakpoint
CREATE TABLE "code_ref" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"repositoryId" bigint NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"line" integer NOT NULL,
	"enclosing" text
);
--> statement-breakpoint
CREATE TABLE "code_symbol" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"repositoryId" bigint NOT NULL,
	"path" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"startLine" integer NOT NULL,
	"endLine" integer NOT NULL,
	"signature" text NOT NULL,
	"parent" text
);
--> statement-breakpoint
CREATE TABLE "installation" (
	"id" bigint PRIMARY KEY,
	"accountLogin" text NOT NULL,
	"accountType" text NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository" (
	"id" bigint PRIMARY KEY,
	"installationId" bigint NOT NULL,
	"fullName" text NOT NULL,
	"defaultBranch" text NOT NULL,
	"private" boolean NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"indexStatus" text DEFAULT 'pending' NOT NULL,
	"indexedSha" text,
	"indexedAt" timestamp with time zone,
	"indexError" text,
	"fileCount" integer DEFAULT 0 NOT NULL,
	"symbolCount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authAccount" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"accountId" text NOT NULL,
	"providerId" text NOT NULL,
	"userId" uuid NOT NULL,
	"accessToken" text,
	"refreshToken" text,
	"idToken" text,
	"accessTokenExpiresAt" timestamp with time zone,
	"refreshTokenExpiresAt" timestamp with time zone,
	"scope" text,
	"password" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authSession" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"token" text NOT NULL UNIQUE,
	"userId" uuid NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"ipAddress" text,
	"userAgent" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "authVerification" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repository_member" (
	"userId" uuid,
	"repositoryId" bigint,
	CONSTRAINT "repository_member_pkey" PRIMARY KEY("userId","repositoryId")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"emailVerified" boolean DEFAULT false NOT NULL,
	"image" text,
	"login" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "finding" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"reviewId" uuid NOT NULL,
	"repositoryId" bigint NOT NULL,
	"prNumber" integer NOT NULL,
	"path" text NOT NULL,
	"startLine" integer,
	"line" integer NOT NULL,
	"severity" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"suggestion" text,
	"fingerprint" text NOT NULL,
	"githubCommentId" bigint,
	"reactionsUp" integer DEFAULT 0 NOT NULL,
	"reactionsDown" integer DEFAULT 0 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"kind" text NOT NULL,
	"dedupeKey" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"runAt" timestamp with time zone DEFAULT now() NOT NULL,
	"lockedUntil" timestamp with time zone,
	"lastError" text,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "learning" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"repositoryId" bigint NOT NULL,
	"findingId" uuid NOT NULL UNIQUE,
	"verdict" text NOT NULL,
	"text" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"repositoryId" bigint NOT NULL,
	"prNumber" integer NOT NULL,
	"prTitle" text NOT NULL,
	"prAuthor" text NOT NULL,
	"headSha" text NOT NULL,
	"baseSha" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"summary" text,
	"confidence" integer,
	"diagram" text,
	"error" text,
	"model" text,
	"inputTokens" integer DEFAULT 0 NOT NULL,
	"outputTokens" integer DEFAULT 0 NOT NULL,
	"summaryCommentId" bigint,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rule" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7(),
	"repositoryId" bigint NOT NULL,
	"text" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"createdByLogin" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_delivery" (
	"id" text PRIMARY KEY,
	"receivedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "code_ref_repositoryId_name_index" ON "code_ref" ("repositoryId","name");--> statement-breakpoint
CREATE INDEX "code_ref_repositoryId_path_index" ON "code_ref" ("repositoryId","path");--> statement-breakpoint
CREATE INDEX "code_symbol_repositoryId_name_index" ON "code_symbol" ("repositoryId","name");--> statement-breakpoint
CREATE INDEX "code_symbol_repositoryId_path_index" ON "code_symbol" ("repositoryId","path");--> statement-breakpoint
CREATE INDEX "code_symbol_lower_name_idx" ON "code_symbol" ("repositoryId",lower("name"));--> statement-breakpoint
CREATE INDEX "repository_installationId_index" ON "repository" ("installationId");--> statement-breakpoint
CREATE INDEX "repository_fullName_index" ON "repository" ("fullName");--> statement-breakpoint
CREATE INDEX "authAccount_userId_index" ON "authAccount" ("userId");--> statement-breakpoint
CREATE INDEX "authSession_userId_index" ON "authSession" ("userId");--> statement-breakpoint
CREATE INDEX "authVerification_identifier_index" ON "authVerification" ("identifier");--> statement-breakpoint
CREATE INDEX "finding_reviewId_index" ON "finding" ("reviewId");--> statement-breakpoint
CREATE INDEX "finding_repositoryId_prNumber_fingerprint_index" ON "finding" ("repositoryId","prNumber","fingerprint");--> statement-breakpoint
CREATE INDEX "finding_githubCommentId_index" ON "finding" ("githubCommentId");--> statement-breakpoint
CREATE INDEX "job_claim_idx" ON "job" ("status","runAt");--> statement-breakpoint
CREATE UNIQUE INDEX "job_queued_dedupe_idx" ON "job" ("dedupeKey") WHERE "status" = 'queued';--> statement-breakpoint
CREATE INDEX "learning_repositoryId_index" ON "learning" ("repositoryId");--> statement-breakpoint
CREATE INDEX "review_repositoryId_createdAt_index" ON "review" ("repositoryId","createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "review_head_idx" ON "review" ("repositoryId","prNumber","headSha");--> statement-breakpoint
CREATE INDEX "rule_repositoryId_index" ON "rule" ("repositoryId");--> statement-breakpoint
ALTER TABLE "code_file" ADD CONSTRAINT "code_file_repositoryId_repository_id_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repository"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "code_ref" ADD CONSTRAINT "code_ref_repositoryId_repository_id_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repository"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "code_symbol" ADD CONSTRAINT "code_symbol_repositoryId_repository_id_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repository"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "repository" ADD CONSTRAINT "repository_installationId_installation_id_fkey" FOREIGN KEY ("installationId") REFERENCES "installation"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "authAccount" ADD CONSTRAINT "authAccount_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "authSession" ADD CONSTRAINT "authSession_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "repository_member" ADD CONSTRAINT "repository_member_userId_user_id_fkey" FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "repository_member" ADD CONSTRAINT "repository_member_repositoryId_repository_id_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repository"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "finding" ADD CONSTRAINT "finding_reviewId_review_id_fkey" FOREIGN KEY ("reviewId") REFERENCES "review"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "learning" ADD CONSTRAINT "learning_repositoryId_repository_id_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repository"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "learning" ADD CONSTRAINT "learning_findingId_finding_id_fkey" FOREIGN KEY ("findingId") REFERENCES "finding"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "review" ADD CONSTRAINT "review_repositoryId_repository_id_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repository"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "rule" ADD CONSTRAINT "rule_repositoryId_repository_id_fkey" FOREIGN KEY ("repositoryId") REFERENCES "repository"("id") ON DELETE CASCADE;