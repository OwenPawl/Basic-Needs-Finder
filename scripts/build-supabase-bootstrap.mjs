// Produce a reviewable first-install SQL bundle. Never connects to a database.
// Apply only to an empty application's public schema on Supabase.
import {readFileSync,readdirSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
const output=process.argv[2];if(!output)throw new Error('Pass an output SQL file path.');
const names=readdirSync('prisma/migrations').filter(n=>/^\d+_/.test(n)).sort();
let sql=`-- Basic Needs Finder: first installation in Supabase only.\n-- Contains no test auth/storage stand-ins, demo users, listings, or staff grants.\nBEGIN;\nCREATE TABLE public."_prisma_migrations" (id varchar(36) PRIMARY KEY, checksum varchar(64) NOT NULL, finished_at timestamptz, migration_name varchar(255) NOT NULL, logs text, rolled_back_at timestamptz, started_at timestamptz NOT NULL DEFAULT now(), applied_steps_count integer NOT NULL DEFAULT 0);\n`;
for(const name of names){const content=readFileSync(`prisma/migrations/${name}/migration.sql`,'utf8');const hash=createHash('sha256').update(content).digest('hex');sql+=`\n-- ${name}\n${content}\nINSERT INTO public."_prisma_migrations" (id,checksum,finished_at,migration_name,applied_steps_count) VALUES ('${randomUUID()}','${hash}',now(),'${name}',1);\n`;}
sql+='\n'+readFileSync('scripts/wwu-campus.sql','utf8')+'\nCOMMIT;\nNOTIFY pgrst, \'reload schema\';\nSELECT slug,name FROM public."Campus";\n';
writeFileSync(output,sql);console.log(`Prepared ${names.length} migrations and WWU directory configuration (${sql.length} characters).`);
