// Builds schema.org JSON-LD that ties the website to its verified external profiles.
// Only profiles whose latest public check is `healthy` are listed in `sameAs`, so the
// markup never claims an identity link the app has not observed.
export function entitySchema(project, profiles) {
  const person = project.entity_type === 'person';
  const included = profiles.filter((p) => p.status === 'healthy');
  const pending = profiles.filter((p) => p.status !== 'healthy');
  const sameAs = [...new Set(included.map((p) => p.url))].sort();
  const data = {
    '@context': 'https://schema.org',
    '@type': person ? 'Person' : 'Organization',
    '@id': new URL(person ? '#person' : '#organization', project.website).href,
    name: project.name,
    url: project.website,
  };
  if (project.description) data.description = project.description;
  if (project.logo_url) {
    if (!person) data.logo = project.logo_url;
    data.image = project.logo_url;
  }
  // A personal address is not published automatically; organizations list their contact email.
  if (project.email && !person) data.email = project.email;
  if (sameAs.length) data.sameAs = sameAs;
  const json = JSON.stringify(data, null, 2).replace(/</g, '\\u003c');
  return {
    data,
    html: `<script type="application/ld+json">\n${json}\n</script>`,
    included: included.map(({ platform_name, url }) => ({ platform_name, url })),
    pending: pending.map(({ platform_name, url, status }) => ({ platform_name, url, status })),
  };
}
