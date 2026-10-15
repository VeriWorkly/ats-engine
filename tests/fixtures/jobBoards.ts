/**
 * Job board API answers in the shape each board's public API returns (recorded from live postings
 * in October 2026, then rewritten): an invented company, invented text, the real field names. Only
 * the fields `--job-url` reads, and a few it does not, are kept.
 */

export const GREENHOUSE_JOB_ID = "4012345678";
export const LEVER_JOB_ID = "6f1c2b3a-4d5e-4f60-8a7b-9c0d1e2f3a4b";
export const ASHBY_JOB_ID = "0b6d3e1a-2c4f-4a5b-9e8d-7f6a5b4c3d2e";

/**
 * `GET boards-api.greenhouse.io/v1/boards/{board}/jobs/{id}`: `content` is HTML escaped once. The
 * employer's name is in a requirement, where only `company_name` keeps it out of the keywords.
 */
export const GREENHOUSE_JOB = {
  absolute_url: `https://fernbrook.example/careers?gh_jid=${GREENHOUSE_JOB_ID}`,
  id: Number(GREENHOUSE_JOB_ID),
  internal_job_id: 2701234,
  location: { name: "Remote" },
  title: "Platform Engineer",
  company_name: "Fernbrook Analytics",
  updated_at: "2026-10-07T19:02:27-04:00",
  language: "en",
  content: (
    "<p>We build &quot;weather for supply chains&quot;.</p><h3>What you will do</h3>" +
    "<ul><li>Run Fernbrook on Kubernetes and Terraform</li>" +
    "<li>Five years of TypeScript and Go</li>" +
    "<li>Extend the Fernbrook SDK</li></ul>"
  )
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;"),
  departments: [{ id: 1, name: "Engineering" }],
  offices: [{ id: 2, name: "Remote" }],
};

/** `GET api.lever.co/v0/postings/{site}/{id}`: no company name; the bullets are in `lists`. */
export const LEVER_JOB = {
  id: LEVER_JOB_ID,
  text: "Data Engineer",
  categories: { commitment: "Full-time", location: "Lisbon", team: "Data" },
  country: "PT",
  workplaceType: "hybrid",
  description:
    "<div><b>The role</b></div><div>Build the pipelines our forecasts run on.&nbsp;</div>",
  descriptionPlain: "The role\nBuild the pipelines our forecasts run on.",
  lists: [
    {
      text: "What you bring",
      content: "<li>Airflow and dbt in production at Fernbrook</li><li>Strong SQL and Python</li>",
    },
  ],
  additional: "<div>We work from Lisbon three days a week.</div>",
  additionalPlain: "We work from Lisbon three days a week.",
  hostedUrl: `https://jobs.lever.co/fernbrook/${LEVER_JOB_ID}`,
  applyUrl: `https://jobs.lever.co/fernbrook/${LEVER_JOB_ID}/apply`,
  createdAt: 1_791_000_000_000,
};

/** `GET api.ashbyhq.com/posting-api/job-board/{org}`: every listed job of the board. */
export const ASHBY_BOARD = {
  apiVersion: "1",
  jobs: [
    {
      id: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      title: "Office Manager",
      department: "Operations",
      employmentType: "FullTime",
      location: "Toronto",
      isListed: true,
      isRemote: false,
      jobUrl: "https://jobs.ashbyhq.com/fernbrook/9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
      descriptionHtml:
        "<p>Keep our Toronto office running. Event planning and vendor contracts.</p>",
      descriptionPlain: "Keep our Toronto office running. Event planning and vendor contracts.",
    },
    {
      id: ASHBY_JOB_ID,
      title: "Machine Learning Engineer",
      department: "Engineering",
      employmentType: "FullTime",
      location: "Remote",
      isListed: true,
      isRemote: true,
      jobUrl: `https://jobs.ashbyhq.com/fernbrook/${ASHBY_JOB_ID}`,
      // Ashby wraps each item's text in a paragraph.
      descriptionHtml:
        "<p>Train Fernbrook's demand models.</p><ul><li><p>PyTorch and Spark</p></li><li><p>Model monitoring</p></li></ul>",
      descriptionPlain: "Train Fernbrook's demand models.\nPyTorch and Spark\nModel monitoring",
    },
  ],
};
