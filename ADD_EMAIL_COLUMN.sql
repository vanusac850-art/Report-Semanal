-- Adiciona a coluna que vai guardar o e-mail de quem enviou (login)
ALTER TABLE reports ADD COLUMN submitted_by_email text;
