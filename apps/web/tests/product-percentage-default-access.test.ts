import assert from 'node:assert/strict';
import test from 'node:test';
import {canAccessSettingsPath,PRODUCT_PERCENTAGE_SETTINGS_PATH} from '../src/lib/settings-access';
import {navItemsForRole} from '../src/lib/nav';
import {NextRequest} from 'next/server';
import {authConfig} from '../src/auth.config';
test('manager exact percentage route does not grant any other admin settings',()=>{assert.equal(canAccessSettingsPath(['MANAGER'],PRODUCT_PERCENTAGE_SETTINGS_PATH),true);assert.equal(canAccessSettingsPath(['MANAGER','ENGINEER'],PRODUCT_PERCENTAGE_SETTINGS_PATH+'/'),true);assert.equal(canAccessSettingsPath(['MANAGER'],'/settings'),true);for(const path of ['/settings/users','/settings/payroll','/settings/modules','/settings/api',PRODUCT_PERCENTAGE_SETTINGS_PATH+'/users',PRODUCT_PERCENTAGE_SETTINGS_PATH+'-other'])assert.equal(canAccessSettingsPath(['MANAGER'],path),false);for(const roles of [['ENGINEER'],['ACCOUNTANT'],['WORKER'],[]] as Parameters<typeof canAccessSettingsPath>[0][])assert.equal(canAccessSettingsPath(roles,PRODUCT_PERCENTAGE_SETTINGS_PATH),false);assert.equal(canAccessSettingsPath(['ADMIN'],'/settings/users'),true);assert.ok(!navItemsForRole(['MANAGER']).some(row=>row.href===PRODUCT_PERCENTAGE_SETTINGS_PATH));assert.ok(navItemsForRole(['MANAGER']).some(row=>row.href==='/settings'));});
test('actual auth route callback permits only the new manager settings path, retaining finance and administrator boundaries',()=>{
 const auth={user:{id:'manager',sessionVersion:0,roles:['MANAGER' as const]},expires:'2099-01-01'};
 assert.equal(authConfig.callbacks.authorized({auth,request:new NextRequest(`http://example.invalid${PRODUCT_PERCENTAGE_SETTINGS_PATH}`)}),true);
 assert.equal(authConfig.callbacks.authorized({auth,request:new NextRequest('http://example.invalid/settings')}),true);
 for(const path of ['/settings/users','/settings/payroll','/settings/modules','/settings/api','/changelog','/finance']){
  const result=authConfig.callbacks.authorized({auth,request:new NextRequest(`http://example.invalid${path}`)});
  assert.ok(result instanceof Response);assert.equal(result.headers.get('location'),'http://example.invalid/');
 }
});
