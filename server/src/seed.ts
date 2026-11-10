import { openDb, seed } from './db';

const db = openDb();
const out = seed(db);
db.close();
console.log(`Seeded ${out.posts} posts and ${out.content} content blocks.`);
