{{- define "nitpick.labels" -}}
app.kubernetes.io/name: nitpick
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Values.image.tag | default .Chart.AppVersion | quote }}
{{- end -}}

{{- define "nitpick.tag" -}}
{{- .Values.image.tag | default .Chart.AppVersion -}}
{{- end -}}

{{- define "nitpick.envFrom" -}}
- configMapRef:
    name: nitpick
- secretRef:
    name: {{ .Values.secretName }}
{{- end -}}
