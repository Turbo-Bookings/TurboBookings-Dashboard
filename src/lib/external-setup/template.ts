// Default checklist seeded into every new location. Each row is one
// external dependency that has wall-clock time (often days) between
// "start" and "done." Keep this list pragmatic — only items that the
// operator/VA/client must actually do.

import type { ExternalSetupItem } from "@/lib/db/schema";

type TemplateItem = Pick<
  ExternalSetupItem,
  "phase" | "kind" | "label" | "description" | "sortOrder"
>;

export const PHASE_LABELS: Record<ExternalSetupItem["phase"], string> = {
  domain_dns: "Domain + DNS",
  tracking_platforms: "Tracking platforms",
  email_sms: "Email + SMS",
  fareharbor: "FareHarbor",
  site_infrastructure: "Site infrastructure",
  indexing: "Indexing + SEO",
  cutover: "Cutover",
};

export const SETUP_TEMPLATE: TemplateItem[] = [
  // Phase A — Domain + DNS
  { phase: "domain_dns", kind: "domain_registered", label: "Domain registered + nameservers", description: "Domain purchased from a registrar; nameservers pointing where DNS will live (Vercel or external DNS provider).", sortOrder: 10 },
  { phase: "domain_dns", kind: "apex_dns_to_vercel", label: "Apex A record → Vercel", description: "Apex DNS resolves to Vercel.", sortOrder: 20 },
  { phase: "domain_dns", kind: "www_dns_to_vercel", label: "www CNAME → Vercel", description: "www subdomain resolves to Vercel.", sortOrder: 30 },
  { phase: "domain_dns", kind: "send_subdomain_dns", label: "send. subdomain DNS for Resend", description: "TXT + MX records for the marketing sending subdomain.", sortOrder: 40 },
  { phase: "domain_dns", kind: "spf_dkim_dmarc", label: "SPF / DKIM / DMARC at apex", description: "Email authentication records. DMARC starts at p=none, tighten after monitoring.", sortOrder: 50 },

  // Phase B — Tracking platforms
  { phase: "tracking_platforms", kind: "meta_domain_verification", label: "Meta domain verification", description: "Meta Business Manager → Brand Safety → Domains. Token configured in Tracking tab + added to <head>.", sortOrder: 60 },
  { phase: "tracking_platforms", kind: "ga4_property_created", label: "GA4 property created", description: "Google Analytics 4 property + data stream. Measurement ID copied into Tracking tab.", sortOrder: 70 },
  { phase: "tracking_platforms", kind: "google_ads_account", label: "Google Ads account + conversion ID", description: "Conversion ID copied into Tracking tab. Ads strategy decision can come later.", sortOrder: 80 },
  { phase: "tracking_platforms", kind: "gtm_container", label: "GTM container (optional)", description: "Only if this client uses GTM. Container ID copied into Tracking tab.", sortOrder: 90 },

  // Phase C — Email + SMS
  { phase: "email_sms", kind: "resend_domain_verified", label: "Resend domain verified", description: "send. subdomain added to Resend, DNS records propagated, status verified in Resend dashboard.", sortOrder: 100 },
  { phase: "email_sms", kind: "twilio_a2p_brand", label: "Twilio A2P 10DLC brand registered", description: "Brand registration submitted. 1-2 weeks lead time — start as early as possible.", sortOrder: 110 },
  { phase: "email_sms", kind: "twilio_a2p_campaign", label: "Twilio A2P 10DLC campaign approved", description: "Use case + sample messages approved by Twilio. Required before SMS sending.", sortOrder: 120 },
  { phase: "email_sms", kind: "twilio_phone_number", label: "Twilio phone number purchased + assigned", description: "Dedicated number for this location's SMS sends. Stored in Edge Config as the From field.", sortOrder: 130 },

  // Phase D — FareHarbor
  { phase: "fareharbor", kind: "fareharbor_account", label: "FareHarbor account created", description: "Account live with shortname + initial tour items configured.", sortOrder: 140 },
  { phase: "fareharbor", kind: "fareharbor_webhook", label: "FareHarbor webhook configured", description: "Webhook URL set to the location site's /api/webhooks/fareharbor + signing secret pasted into Integrations tab.", sortOrder: 150 },
  { phase: "fareharbor", kind: "fareharbor_pixel", label: "FareHarbor Meta pixel installed", description: "FareHarbor's own CAPI integration set up for canonical Purchase events.", sortOrder: 160 },

  // Phase E — Site infrastructure
  { phase: "site_infrastructure", kind: "github_repo", label: "GitHub repo created", description: "Repo created under Turbo-Bookings/<slug>-atv-rentals-site from the takeovers-site template.", sortOrder: 170 },
  { phase: "site_infrastructure", kind: "vercel_project", label: "Vercel project provisioned", description: "Project linked to the GitHub repo, initial deploy successful.", sortOrder: 180 },
  { phase: "site_infrastructure", kind: "neon_database", label: "Neon database provisioned", description: "Per-location Neon DB connected to the Vercel project for any location-specific data.", sortOrder: 190 },
  { phase: "site_infrastructure", kind: "edge_config", label: "Edge Config provisioned + connected", description: "Vercel Edge Config created and linked to the location project so tracking IDs hot-update.", sortOrder: 200 },

  // Phase F — Indexing + SEO
  { phase: "indexing", kind: "gsc_property", label: "Google Search Console verified", description: "Property added + verification token in place.", sortOrder: 210 },
  { phase: "indexing", kind: "sitemap_submitted", label: "Sitemap submitted to GSC", description: "Sitemap.xml URL submitted; first crawl received.", sortOrder: 220 },
  { phase: "indexing", kind: "priority_pages_indexed", label: "Priority pages indexed", description: "Home + top SEO landing pages requested for indexing.", sortOrder: 230 },

  // Phase G — Cutover
  { phase: "cutover", kind: "dns_cutover", label: "Production DNS cutover", description: "DNS switched from old site (if any) to the new Vercel project.", sortOrder: 240 },
  { phase: "cutover", kind: "old_site_redirects", label: "Old site redirects in place", description: "If migrating from an existing site (Duda etc.), 301 redirects from old URLs.", sortOrder: 250 },
  { phase: "cutover", kind: "verification_week", label: "1-week verification monitoring", description: "Watch tracking + bookings + indexing for at least a week before considering the launch complete.", sortOrder: 260 },
];
