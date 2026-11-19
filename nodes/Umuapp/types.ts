import { IDataObject } from "n8n-workflow";

export interface CalendarEvent extends IDataObject {
    id: number,
    titulo: string,
    tipo: string,
    subtipo: string,
    inicio: Date,
    fin: Date,
    dia: boolean,
    descripcion?: string;
    ubicacion: string,
    registro: Date,
    elemento: {
        item: string,
        grupo: string,
        subgrupo: string,
        curso: string,
        cuatrimestre: string,
        titulacion: string,
        codigo_grupo: string,
        codigo_subgrupo: number,
        curso_academico: number
    },
    observaciones: unknown[],
    codigo_tipo: number,
    codigo_subtipo: number
}

export interface Alert extends IDataObject {
    aplicacion: "Aula Virtual" | "ENCUESTAS",
    categoria: "Académica" | "Otra información administrativa",
    personal: boolean,
    titulo: string,
    descripcion: string,
    estado: "LE" | "NL",
    codigo_alerta: number,
    codigo_aplicacion: number,
    codigo_servicio_hijo: null | number,
    servicio_hijo: null | number,
    codigo_categoria: number,
    fecha_creacion: Date,
    fecha_envio: Date,
    correo_emisor: string,
    referencia_web: string
}