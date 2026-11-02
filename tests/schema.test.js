import test from 'node:test';
import assert from 'node:assert/strict';
import { entitySchema } from '../server/schema.js';
import { setupStore } from './helpers.js';

test('entity schema lists only healthy profiles in sameAs and escapes markup', () => {
  const { store, project } = setupStore();
  const github = store.putProfile(project.id, 'github', 'https://github.com/brand-one');
  store.putProfile(project.id, 'gitlab', 'https://gitlab.com/brand-one');
  store.run("UPDATE profiles SET status='healthy' WHERE id=?", github.id);
  const profiles = store.all(
    'SELECT f.url,f.status,t.name AS platform_name FROM profiles f JOIN platforms t ON t.id=f.platform_id WHERE f.project_id=?',
    project.id,
  );
  const result = entitySchema(
    { ...project, description: 'Mô tả </script><b>', logo_url: 'https://one.example.com/logo.png' },
    profiles,
  );
  assert.equal(result.data['@type'], 'Organization');
  assert.equal(result.data['@id'], 'https://one.example.com/#organization');
  assert.deepEqual(result.data.sameAs, ['https://github.com/brand-one']);
  assert.equal(result.data.logo, 'https://one.example.com/logo.png');
  assert.equal(result.pending.length, 1);
  assert.equal(result.html.includes('</script><b>'), false);
  const json = result.html.replace(/^<script[^>]*>\n|\n<\/script>$/g, '');
  assert.equal(JSON.parse(json).description, 'Mô tả </script><b>');

  const person = entitySchema(
    { ...project, entity_type: 'person', email: 'me@one.example.com' },
    [],
  );
  assert.equal(person.data['@type'], 'Person');
  assert.equal(person.data.email, undefined);
  assert.equal(person.data.sameAs, undefined);
  store.close();
});
