import {describe,it,expect} from 'vitest';
import {commentText,reportText,activityTime,activityError,definiteActivityFailure} from '../src/lib/activity';
describe('activity input and recovery contracts',()=>{
 it('counts Unicode code points after ECMAScript whitespace trimming',()=>{expect(commentText(' \u00a0\ufeff'+'🦎'.repeat(500)+' ')).toBe('🦎'.repeat(500));expect(()=>commentText('🦎'.repeat(501))).toThrow('1~500');expect(()=>commentText('\ufeff \n')).toThrow();});
 it('keeps input as literal text and permits an empty report detail',()=>{expect(commentText('<script>alert(1)</script> @회원')).toBe('<script>alert(1)</script> @회원');expect(reportText(' ')).toBe('');expect(()=>reportText('가'.repeat(501))).toThrow('500');});
 it('formats Seoul time without using the client timezone as a cursor',()=>{expect(activityTime('2026-10-28T15:01:00.123456Z')).toContain('29');expect(activityTime('2026-10-28T15:01:00Z')).toContain('00:01');});
 it('only a complete known database failure may release an attempted command',()=>{expect(definiteActivityFailure({message:'RATE_LIMITED'})).toBe(true);for(const message of ['Failed to fetch','REQUEST_FAILED','some NOT_FOUND from a proxy',''])expect(definiteActivityFailure({message})).toBe(false);expect(activityError({message:'RATE_LIMITED'})).toContain('잠시 후');});
});
