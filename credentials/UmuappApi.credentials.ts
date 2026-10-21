import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class UmuappApi implements ICredentialType {
    name = 'umuappApi';

    displayName = 'UMUApp API';

    icon = 'file:umuapp.svg' as const;

    documentationUrl = 'https://umuapp.um.es/umuapp/doc/';

    properties: INodeProperties[] = [
        {
            displayName: "Usuario",
            name: "username",
            type: "string",
            required: true,
            default: "",
            placeholder: "tu@um.es"
        },
        {
            displayName: "Contraseña",
            name: "password",
            type: "string",
            typeOptions: { password: true },
            required: true,
            default: "",
        },
    ];

    test?: ICredentialTestRequest | undefined;
}
