import { MongoClient } from 'mongodb';

const mongo = new MongoClient(process.env.MONGO_URI, {});
export default mongo;
