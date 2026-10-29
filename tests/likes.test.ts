import {it,expect} from 'vitest';
import {likeRequestExpired,likeError} from '../src/lib/likes';
it('stops resending an unknown request at the monotonic24h guarantee boundary',()=>{const started=1234;expect(likeRequestExpired(started,started+24*60*60*1000-1)).toBe(false);expect(likeRequestExpired(started,started+24*60*60*1000)).toBe(true);expect(likeRequestExpired(started,started+25*60*60*1000)).toBe(true);});
it('shows only bounded server wait hints and never raw diagnostic strings',()=>{expect(likeError({message:'RATE_LIMITED',hint:'61'})).toContain('2분');for(const hint of ['SQL secret', '-1','4000'])expect(likeError({message:'RATE_LIMITED',hint})).not.toContain(hint);expect(likeError({message:'NOT_FOUND'})).toBeNull();});

it('a wall-time safety check also expires a request when elapsed clocks disagree',()=>{expect(likeRequestExpired(10,11,1000,1000+25*60*60*1000)).toBe(true);expect(likeRequestExpired(10,10+25*60*60*1000,1000,0)).toBe(true);});
