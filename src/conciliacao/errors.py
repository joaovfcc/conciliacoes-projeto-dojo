"""Exceções tipadas e acionáveis da aplicação."""


class ConciliacaoError(Exception):
    """Erro base conhecido, adequado para apresentação sem stack trace."""

    code = "CONCILIACAO_ERROR"


class DataValidationError(ConciliacaoError):
    """Valor ou registro de entrada inválido."""

    code = "DADO_INVALIDO"


class FileValidationError(ConciliacaoError):
    """Arquivo não atende ao contrato de entrada."""

    code = "ARQUIVO_INVALIDO"


class ConfigurationError(ConciliacaoError):
    """Configuração ausente, inconsistente ou insegura."""

    code = "CONFIGURACAO_INVALIDA"


class DuplicateFileError(FileValidationError):
    """Conteúdo já processado em execução anterior."""

    code = "ARQUIVO_DUPLICADO"
