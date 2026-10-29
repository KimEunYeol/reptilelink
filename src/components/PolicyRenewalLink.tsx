export function PolicyRenewalLink({message}:{message:string}){
 return message.includes('이용 안내에 동의해주세요.')?<><br/><a className="text-button" href="/onboarding" target="_blank" rel="noopener noreferrer">새 탭에서 필수 안내 확인</a><small> 확인 후 이 화면에서 다시 시도해주세요.</small></>:null;
}
