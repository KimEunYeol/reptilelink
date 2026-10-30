import {runProductionCommand} from './production-backup.mjs';
try{console.log(JSON.stringify(await runProductionCommand(),null,2));}
catch(error){console.error(/^[A-Z][A-Z0-9_]+$/.test(error.message)?error.message:'PRODUCTION_BACKUP_FAILED');process.exitCode=1;}
