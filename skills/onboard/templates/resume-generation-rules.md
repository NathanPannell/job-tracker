# Résumé generation rules

`master-resume.tex` is the source of approved résumé wording. Tailored résumés select from it and
from `knowledge-base/` without broadening scope.

## Required format

- Every tailored résumé uses `resume-format-template.tex` as its visual template. Keep its
  preamble, fonts, margins, header, section rules and custom commands byte for byte.
- Keep the template's section order: <sections, in order>.
- Match the template's level of detail: <roles and bullets per role, projects and bullets per
  project, skill lines>, filling one page.
- The template's wording is a sample of that shape, not a source. Pull every role, project, bullet,
  date, metric and skill fresh from `master-resume.tex` and the knowledge base for each posting.
- Compile from LaTeX. Do not recreate the template in another format.
- Optimize for fast scanning: one-to-two-line bullets, no summary line or keyword tagline.
- The header shows one email address, the one the person uses on forms.

## Choosing roles and projects (per posting, never by default)

1. Read the posting and list what it values most.
2. Rank every candidate project and role against that list. Start from the flagships:
   <flagship roles and projects>. Swap one out only for a specific reason.
3. Choose roles by relevance, but always list them most recent first. Relevance decides which
   roles appear and which gets the most bullets, never their order.
4. Rebuild the skills lines from what the chosen roles and projects show. Never list something the
   person has not used.
5. Write the choice in `sources.md` under a "Selection" heading: each pick, one line on why, and
   what was left out.

## Writing bullets

- Lead with what the person built or decided and why it mattered, in words a recruiter follows on
  one read. Never credit an AI tool or agent with the work.
- Prefer evidence and outcomes over lists of technologies.
- Every number keeps the conditions recorded in the knowledge base, and the same fact uses the
  same figure on every résumé.
- Date every project, so the time since the last job never reads as idle.
- No hedges ("a reported") and no private jargon a recruiter would not know.
- Shortening and simplifying must not broaden scope or add claims.
