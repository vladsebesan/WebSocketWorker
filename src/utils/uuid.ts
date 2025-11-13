import { v4 as uuidv4 } from 'uuid';

export function makeUUID() : string{
    return uuidv4();
}