import test from 'node:test';import assert from 'node:assert/strict';
import {assertTechnical} from './warehouse-units-stage-wire.mjs';
test('no secret or JWT payload is allowed in technical persistence, recursively',()=>{for(const value of [{cookies:[{value:'private'}]},{passwordHash:'private'},{nested:'{"authorization":"private"}'},{x:'Cookie: private'},{jwt:'a'.repeat(20)+'.'+'b'.repeat(20)+'.'+'c'.repeat(20)}])assert.throws(()=>assertTechnical(value));assert.doesNotThrow(()=>assertTechnical({actors:[{id:'own',roles:['ADMIN'],passwordDisabled:true}]}));});
