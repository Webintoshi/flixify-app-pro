import type { FastifyInstance } from 'fastify';
import { BlockedUserRouteError } from './user-route-error.js';
import type { WelcomeStatus } from './welcome-offer.js';
export function registerWelcomeOfferRoutes(app:FastifyInstance,deps:{authenticate(authorization?:string):Promise<{userId:string}>;store:{status(userId:string):Promise<WelcomeStatus>;choose(userId:string,choice:'trial'|'monthly'):Promise<WelcomeStatus>}}):void {
  const authenticate=async(authorization?:string)=>{try{return{userId:(await deps.authenticate(authorization)).userId,status:401};}catch(error){return{userId:null,status:error instanceof BlockedUserRouteError?403:401};}};
  app.get('/me/welcome-offer',async(request,reply)=>{
    reply.header('cache-control','private, no-store');const auth=await authenticate(request.headers.authorization);
    if(!auth.userId)return reply.code(auth.status).send({error:auth.status===403?'blocked':'unauthorized'});
    return deps.store.status(auth.userId);
  });
  app.post('/me/welcome-offer/choice',async(request,reply)=>{
    reply.header('cache-control','private, no-store');const auth=await authenticate(request.headers.authorization);
    if(!auth.userId)return reply.code(auth.status).send({error:auth.status===403?'blocked':'unauthorized'});
    const choice=(request.body as {choice?:unknown}|null)?.choice;
    if(choice!=='trial'&&choice!=='monthly')return reply.code(400).send({error:'invalid_choice'});
    return deps.store.choose(auth.userId,choice);
  });
}
