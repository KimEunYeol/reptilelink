import type {ReactNode} from 'react';
import {Link} from 'react-router-dom';
import {ManagementFooter,SourceBrand} from './ManagementShell';
export function SourcePage({children,signedIn=false,locked=false,onSignOut}:{children:ReactNode;signedIn?:boolean;locked?:boolean;onSignOut?:()=>void}){
 return <div className="source-page"><header className="management-header"><SourceBrand/><nav className="management-header-actions" aria-label="계정 메뉴">{signedIn?<>{onSignOut&&<button className="button ghost" disabled={locked} onClick={onSignOut}>로그아웃</button>}<Link className="button" to="/dashboard/animals">마이페이지</Link></>:<><Link className="button ghost" to="/auth/login">로그인</Link><Link className="button" to="/auth/login">무료 회원가입</Link></>}</nav></header>{children}<ManagementFooter/></div>;
}
