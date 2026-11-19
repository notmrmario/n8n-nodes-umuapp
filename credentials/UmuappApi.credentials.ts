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
        {
            displayName: "Token de aplicación (UMUapp-Authentication-Token)",
            name: "appAuthToken",
            type: "string",
            typeOptions: { password: true },
            default: "",
            description:
                "Solo para Aula Virtual. Valor de la cabecera UMUapp-Authentication-Token que la app envía al CAS al pedir tickets (aparece en la especificación de la API). Si el CAS responde 401/403 al pedir el ticket, rellénalo",
        },
        {
            displayName: "URL de Aula Virtual",
            name: "aulaVirtualUrl",
            type: "string",
            default: "https://aulavirtual.um.es",
            description: "Solo para Aula Virtual",
        },
        {
            displayName: "URL del servicio (ticket CAS)",
            name: "aulaServiceUrl",
            type: "string",
            default: "",
            placeholder: "https://aulavirtual.um.es/sakai-login-tool/container",
            description:
                "Servicio para el que se pide el ticket CAS y donde se canjea. Vacío = URL de Aula Virtual + /sakai-login-tool/container (suposición)",
        },
        {
            displayName: "User-Agent (opcional)",
            name: "userAgent",
            type: "string",
            default: "",
            description:
                "Solo para Aula Virtual. Vacío = el de n8n. Si el servidor cierra la conexión sin responder, prueba con el User-Agent de tu navegador",
        },
        {
            displayName: "URL del CAS",
            name: "casUrl",
            type: "string",
            default: "https://entrada.um.es/cas",
            description: "Solo para Aula Virtual",
        },
    ];

    test?: ICredentialTestRequest | undefined;
}
