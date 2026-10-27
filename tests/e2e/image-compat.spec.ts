import { test, expect } from '@playwright/test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Gecko } from '../../src/components/Gecko';
import { inspectWebp } from '../../worker/images';

test('server accepts browser-encoded WebP dimensions', async ({ page }) => {
  await page.goto('/');
  const encoded = await page.evaluate(async source => {
    const image = new Image(); image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`; await image.decode();
    const canvas=document.createElement('canvas'); canvas.width=720; canvas.height=480;
    const ctx=canvas.getContext('2d')!; ctx.fillStyle='#e9f1df'; ctx.fillRect(0,0,720,480); ctx.drawImage(image,0,0,720,480);
    return canvas.toDataURL('image/webp',0.85).split(',')[1];
  },renderToStaticMarkup(createElement(Gecko)));
  const bytes=Buffer.from(encoded,'base64');
  const tags=[];
  for(let pos=12;pos+8<=bytes.length;) { const size=bytes.readUInt32LE(pos+4); tags.push(bytes.toString('ascii',pos,pos+4)); pos+=8+size+(size%2); }
  console.log('Browser WebP chunks:',tags.join(', '));
  expect(inspectWebp(bytes)).toEqual({width:720,height:480});
});
